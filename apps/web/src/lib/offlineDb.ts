import { clear, createStore, del, get, set, type UseStore } from "idb-keyval";

import type { AllocationType, ExpenseDto } from "@expense-app/shared";

/**
 * IndexedDB persistence for the offline Today layer (plan §4).
 *
 * A single key-value store holds:
 * - key "today" → today-cache: the last successful `list(day)` snapshot,
 *   tagged with the Jakarta civil day key it belongs to plus the server's
 *   authoritative from/to (a wrong device clock cannot silently mix days —
 *   server range wins when present).
 * - key "outbox:<token>" → FIFO queue of unsynced mutations, scoped per user
 *   token so different PIN spaces never leak into each other.
 *
 * One store (one upgrade creating it) avoids the classic two-store race where
 * whichever connection opens first defines the schema.
 */

const DB_NAME = "expense-app-offline";
const DB_STORE_NAME = "kv";
const TODAY_KEY = "today";

const store: UseStore = createStore(DB_NAME, DB_STORE_NAME);

// ---------------------------------------------------------------------------
// Today cache
// ---------------------------------------------------------------------------

/** Jakarta civil day key (YYYY-MM-DD) from an ISO string / Date. */
export function civilDayKey(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const jakarta = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  // en-CA yields YYYY-MM-DD directly.
  return jakarta;
}

export interface TodayCache {
  expenses: ExpenseDto[];
  total: number;
  /** Jakarta civil day key this snapshot belongs to. */
  dayKey: string;
  /** Server's authoritative range for the day (offset ISO strings). */
  from: string | null;
  to: string | null;
  /** Marker datetime sent with the request (server clock anchor). */
  occurredAt: string | null;
  cachedAt: number;
}

/** Best-effort cache write — never lets IDB failures escape as unhandled. */
export async function saveTodayCache(cache: Omit<TodayCache, "cachedAt">): Promise<void> {
  try {
    await set(TODAY_KEY, { ...cache, cachedAt: Date.now() }, store);
  } catch {
    // IDB unavailable (iOS private mode) → offline layer degrades gracefully.
  }
}

export async function loadTodayCache(): Promise<TodayCache | null> {
  try {
    return (await get<TodayCache>(TODAY_KEY, store)) ?? null;
  } catch {
    return null;
  }
}

export async function clearTodayCache(): Promise<void> {
  try {
    await del(TODAY_KEY, store);
  } catch {
    // ignore
  }
}

/**
 * Read-modify-write the today-cache (offline mutations patch the snapshot so
 * an airplane reload still shows rows created/edited/deleted offline).
 * No-op when nothing is cached yet — the next online fetch snapshots fresh.
 * Shares the global write lock with the outbox writers.
 */
export function mutateTodayCache(mutate: (cache: TodayCache) => TodayCache): Promise<void> {
  return serialized(async () => {
    const current = await loadTodayCache();
    if (!current) return;
    await saveTodayCache(mutate(current));
  });
}

/** Wipe every offline datum (cache + all outboxes). Used on logout/tests. */
export async function clearAllOfflineData(): Promise<void> {
  try {
    await clear(store);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Outbox (FIFO, per token)
// ---------------------------------------------------------------------------

export type OutboxOpType = "create" | "update" | "delete";

export interface OutboxOp {
  opId: string;
  type: OutboxOpType;
  /** Real expense id for update/delete against the server. */
  realId?: string;
  /** Client-side temp id for an offline create (temp-...). */
  tempId?: string;
  /** create → full payload incl. occurredAt + allocationType; update → { amount, allocationType }. */
  payload: { amount: number; occurredAt?: string; allocationType?: AllocationType };
  /** Wall-clock time the mutation was queued (FIFO ordering + diagnostics). */
  occurredAt: number;
  retries: number;
}

function newOpId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Client-side temp id for an offline create. */
export function newTempId(): string {
  return `temp-${newOpId()}`;
}

/** Namespaced outbox key: mutations of different tokens never mix. */
function outboxKey(token: string): string {
  return `outbox:${token}`;
}

export async function readOutbox(token: string): Promise<OutboxOp[]> {
  try {
    return (await get<OutboxOp[]>(outboxKey(token), store)) ?? [];
  } catch {
    return [];
  }
}

export async function writeOutbox(token: string, ops: OutboxOp[]): Promise<void> {
  await set(outboxKey(token), ops, store);
}

export async function clearOutbox(token: string): Promise<void> {
  try {
    await del(outboxKey(token), store);
  } catch {
    // ignore
  }
}

export async function countOutbox(token: string): Promise<number> {
  return (await readOutbox(token)).length;
}

// --- Serialized writers -----------------------------------------------------
// IDB has no transactions across get+set, so ALL outbox writers go through
// one promise chain. This makes concurrent enqueue (user types fast) and
// drain-step writes race-free.

let writeChain: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

/** Read-modify-write the outbox under the global write lock. */
export function mutateOutbox<T>(
  token: string,
  mutate: (ops: OutboxOp[]) => { ops: OutboxOp[]; result: T },
): Promise<T> {
  return serialized(async () => {
    const ops = await readOutbox(token);
    const { ops: next, result } = mutate(ops);
    await writeOutbox(token, next);
    return result;
  });
}

/** Append one mutation to the FIFO outbox (serialized writer). */
export function enqueueOp(
  token: string,
  op: Omit<OutboxOp, "opId" | "retries" | "occurredAt"> & { opId?: string },
): Promise<OutboxOp> {
  return mutateOutbox(token, (ops) => {
    const full: OutboxOp = {
      ...op,
      opId: op.opId ?? newOpId(),
      occurredAt: Date.now(),
      retries: 0,
    };
    const next = [...ops, full];
    return { ops: next, result: full };
  });
}

/** Replace the whole outbox (used by the sync drain loop). */
export async function replaceOps(token: string, ops: OutboxOp[]): Promise<void> {
  await writeOutbox(token, ops);
}
