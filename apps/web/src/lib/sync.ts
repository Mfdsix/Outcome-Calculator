import type { ExpenseDto } from "@expense-app/shared";

import { UnauthorizedError, expensesApi } from "./api";
import {
  civilDayKey,
  enqueueOp,
  newTempId,
  readOutbox,
  replaceOps,
  saveTodayCache,
  type OutboxOp,
} from "./offlineDb";

/**
 * Offline mutation queueing + auto-sync drain engine (plan §6).
 *
 * Queue side: offline mutations are appended FIFO (create with a temp id,
 * update/delete addressed to a real id). Coalescing runs at drain time:
 *   create+update → single create (final amount)
 *   create+delete → both dropped
 *   update+update → last amount wins
 * Drain side: strict FIFO replay against the API with tempId→realId mapping;
 * network failures stop the drain for retry later, 404/4xx drop the op.
 */

// ---------------------------------------------------------------------------
// Queueing (called from App mutation paths)
// ---------------------------------------------------------------------------

/** Enqueue an offline create; returns the temp id used in the UI list. */
export async function queueOfflineCreate(
  token: string,
  payload: { amount: number; occurredAt: string },
  tempId = newTempId(),
): Promise<string> {
  await enqueueOp(token, { type: "create", tempId, payload });
  return tempId;
}

export async function queueOfflineUpdate(
  token: string,
  realId: string,
  amount: number,
): Promise<void> {
  await enqueueOp(token, { type: "update", realId, payload: { amount } });
}

export async function queueOfflineDelete(token: string, realId: string): Promise<void> {
  await enqueueOp(token, { type: "delete", realId, payload: { amount: 0 } });
}

// ---------------------------------------------------------------------------
// Coalescing (pure — heavily unit-tested)
// ---------------------------------------------------------------------------

/**
 * Collapse an op list per plan §6. Only a leading run of ops that forms a
 * create-head chain coalesces; ops on real ids are kept as-is.
 */
export function coalesceOps(ops: OutboxOp[]): OutboxOp[] {
  const result: OutboxOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.type === "create") {
      let j = i + 1;
      let finalAmount = op.payload.amount;
      let deleted = false;
      while (j < ops.length) {
        const next = ops[j]!;
        const targetsCreate =
          (next.type === "update" || next.type === "delete") &&
          (next.realId === op.tempId || next.tempId === op.tempId);
        if (!targetsCreate) break;
        if (next.type === "update") finalAmount = next.payload.amount;
        if (next.type === "delete") deleted = true;
        j += 1;
      }
      if (!deleted) {
        result.push({
          ...op,
          payload: { ...op.payload, amount: finalAmount },
        });
      }
      i = j; // consumed the create + its chain (or dropped everything)
      continue;
    }
    result.push(op);
    i += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Drain (sync engine)
// ---------------------------------------------------------------------------

/** Tidy transient fields after replaying one op against the server. */
function postProcessOps(ops: OutboxOp[]): OutboxOp[] {
  return ops.map((op) => ({ ...op, retries: 0 }));
}

export interface DrainResult {
  /** Ops left in the outbox after this drain attempt. */
  remaining: number;
  /** Ops dropped as permanently rejected (404 / 4xx validation). */
  dropped: number;
  /** Set when a non-offline hard failure stopped the drain (e.g. 401). */
  authFailed: boolean;
  /** Messages for ops dropped due to validation (4xx non-404). */
  validationErrors: string[];
}

/**
 * Replay the outbox FIFO against the server. Mutates the stored outbox via
 * replaceOps after each step so a crash mid-drain never replays twice.
 */
export async function drainOutbox(
  token: string,
  api: {
    create: typeof expensesApi.create;
    update: typeof expensesApi.update;
    remove: typeof expensesApi.remove;
  } = expensesApi,
): Promise<DrainResult> {
  const result: DrainResult = {
    remaining: 0,
    dropped: 0,
    authFailed: false,
    validationErrors: [],
  };

  let ops = coalesceOps(await readOutbox(token));
  await replaceOps(token, ops);

  /** Pop the FIFO head, remap temp→real ids, persist. */
  const advance = async (tempId: string | undefined, realId: string | undefined): Promise<void> => {
    ops = postProcessOps(
      ops.slice(1).map((next) => {
        if (tempId !== undefined && (next.realId === tempId || next.tempId === tempId)) {
          return { ...next, realId: realId ?? next.realId, tempId: undefined };
        }
        return next;
      }),
    );
    await replaceOps(token, ops);
  };

  while (ops.length > 0) {
    const op = ops[0]!;

    try {
      if (op.type === "create") {
        const saved = await api.create({
          amount: op.payload.amount,
          ...(op.payload.occurredAt ? { occurredAt: op.payload.occurredAt } : {}),
        });
        await advance(op.tempId, saved.id);
      } else if (op.type === "update") {
        await api.update(op.realId!, { amount: op.payload.amount });
        await advance(undefined, undefined);
      } else {
        await api.remove(op.realId!);
        await advance(undefined, undefined);
      }
    } catch (cause) {
      if (cause instanceof UnauthorizedError) {
        result.authFailed = true;
        result.remaining = ops.length;
        await replaceOps(token, ops);
        return result;
      }
      const status = (cause as { status?: number }).status ?? 0;
      if (status === 0) {
        // Network still down (or ApiError(0)) → stop, retry later. FIFO head
        // stays in place so ordering is preserved.
        result.remaining = ops.length;
        return result;
      }
      if (status === 404) {
        // update 404 → someone else deleted it: drop (delete wins).
        // delete 404 → already gone: count as success.
        ops = ops.slice(1);
        result.dropped += 1;
        await replaceOps(token, ops);
        continue;
      }
      // 4xx validation (and unexpected 5xx): drop + surface once.
      ops = ops.slice(1);
      result.dropped += 1;
      result.validationErrors.push(
        cause instanceof Error ? cause.message : `Request failed (${status})`,
      );
      await replaceOps(token, ops);
      continue;
    }
  }

  result.remaining = 0;
  return result;
}

// ---------------------------------------------------------------------------
// Server-refresh + cache write (shared by useExpenses + sync lifecycle)
// ---------------------------------------------------------------------------

/**
 * Refresh the server day list, persist it into the today-cache and return it.
 * The server's from/to anchors the cached day so device-clock skew cannot
 * silently swap which day is displayed.
 */
export async function fetchAndCacheDay(
  from: string,
  to: string,
  occurredAt: string,
): Promise<ExpenseListResponseLike> {
  const response = await expensesApi.list(from, to, occurredAt);
  await saveTodayCache({
    expenses: response.expenses,
    total: response.total,
    dayKey: civilDayKey(occurredAt),
    from,
    to,
    occurredAt,
  });
  return response;
}

export interface ExpenseListResponseLike {
  expenses: ExpenseDto[];
  total: number;
}
