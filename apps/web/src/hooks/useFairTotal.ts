import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { fairTotalForPeriod } from "@expense-app/shared";

import { expensesRepository } from "../lib/repository";
import { APP_TIMEZONE, currentPeriodRange, expandedFairQuery } from "../lib/periods";
import { type ApiError, OfflineError } from "../lib/api";
import type { ExpenseDto } from "@expense-app/shared";
import type { Period } from "../types/ui";
import type { TotalMode } from "./useTotalMode";

export interface UseFairTotalResult {
  fairTotal: number | null;
  fairLoading: boolean;
}

/**
 * Fetch the allocation-aware ("fair") total for the current period.
 *
 * - Skips work entirely when mode === "raw" (returns null, no request).
 * - On fair mode: fetches an expanded range (period.from − 30d → period.to) so
 *   allocated expenses whose windows overlap the period are included, then
 *   computes the fair total locally with fairTotalForPeriod (capped at tomorrow
 *   Jakarta midnight).
 * - Merges in-memory optimistic rows (temp-/optimistic- prefixed ids).
 * - Aborts on period/mode/refreshKey change; on error/offline falls back to
 *   null so the caller displays the raw total.
 *
 * `now` is injectable for deterministic tests. In production, the timestamp
 * is frozen on first render and re-captured only when `refreshKey` changes,
 * so a `new Date()` default does not cause refetch loops. `refreshKey` lets
 * the caller trigger a refetch when the expense list changes via CRUD.
 */
export function useFairTotal(
  period: Period,
  mode: TotalMode,
  /** In-memory optimistic rows from useExpenses (temp-/optimistic- ids). */
  optimisticExpenses: Pick<ExpenseDto, "id" | "amount" | "occurredAt" | "allocationType">[],
  /** Arbitrary key that triggers a refetch when it changes (e.g. expenses.length). */
  refreshKey: unknown = undefined,
  /** Injectable "now" for deterministic tests. */
  now: Date = new Date(),
): UseFairTotalResult {
  const [fairTotal, setFairTotal] = useState<number | null>(null);
  const [fairLoading, setFairLoading] = useState(false);

  const inflightRef = useRef<AbortController | null>(null);

  // Freeze the timestamp: capture once on mount, then only update when
  // refreshKey changes. This prevents `new Date()` prop churn from causing
  // recompute/refetch on every render.
  const nowTimestampRef = useRef<number>(now.getTime());
  useLayoutEffect(() => {
    nowTimestampRef.current = now.getTime();
  }, [refreshKey, now]);

  const fetchFair = useCallback(
    (signal: AbortSignal) => {
      if (mode !== "fair") return;
      setFairLoading(true);
      setFairTotal(null);

      const frozenNow = new Date(nowTimestampRef.current);
      const { from, to } = expandedFairQuery(period, frozenNow);
      const range = currentPeriodRange(period, frozenNow);

      expensesRepository
        .list(from, to)
        .then((response) => {
          if (signal.aborted) return;
          const serverIds = new Set(response.expenses.map((e) => e.id));
          const merged = [...response.expenses];
          for (const opt of optimisticExpenses) {
            if (!serverIds.has(opt.id)) merged.push(opt);
          }

          const total = fairTotalForPeriod(merged, range, APP_TIMEZONE, frozenNow);
          if (!Number.isFinite(total)) return;
          setFairTotal(total);
        })
        .catch((cause: unknown) => {
          if (signal.aborted) return;
          const isOffline =
            cause instanceof OfflineError ||
            (cause instanceof Error && "status" in cause && (cause as ApiError).status === 0);
          if (isOffline) {
            setFairTotal(null);
            return;
          }
          if (cause instanceof Error && "status" in cause && (cause as ApiError).status === 401) {
            setFairTotal(null);
            return;
          }
          setFairTotal(null);
        })
        .finally(() => {
          if (signal.aborted) return;
          setFairLoading(false);
        });
    },
    [mode, period, optimisticExpenses],
  );

  useEffect(() => {
    if (mode !== "fair") {
      inflightRef.current?.abort();
      setFairTotal(null);
      setFairLoading(false);
      return;
    }
    const controller = new AbortController();
    inflightRef.current = controller;
    fetchFair(controller.signal);
    return () => controller.abort();
  }, [mode, fetchFair, refreshKey]);

  return { fairTotal, fairLoading };
}
