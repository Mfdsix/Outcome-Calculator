import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  fairBreakdownForDay,
  fairTotalForPeriod,
  getZonedParts,
  zonedWallTimeToUtc,
  addCivilDays,
  toIsoWithOffset,
} from "@expense-app/shared";

import { expensesRepository } from "../lib/repository";
import { APP_TIMEZONE } from "../lib/periods";
import { type ApiError, OfflineError } from "../lib/api";
import type { ExpenseDto } from "@expense-app/shared";
import type { FairBreakdown } from "@expense-app/shared";
import type { PeriodRange } from "@expense-app/shared";
import type { TotalMode } from "./useTotalMode";

export interface UseFairDayTotalResult {
  /** Fair total for the focused civil day, or null on error/offline/skip. */
  fairTotal: number | null;
  fairLoading: boolean;
  /** True when at least one expense in the fetched expanded range has an
   * allocationType !== "NONE". */
  hasAllocated: boolean;
  /** Fair breakdown for the focused day (rows + total). Null when not fetched
   * or on error/offline (caller falls back to raw). */
  fairBreakdown: FairBreakdown | null;
}

/**
 * Fetch the allocation-aware ("fair") total for a single focused civil day
 * identified by `dayKey` (YYYY-MM-DD in APP_TIMEZONE), across any period scope
 * (W/M browse selection).
 *
 * - Skips fetch when mode === "raw" (no peek here — the W/M total is already
 *   non-clickable in raw mode unless the period-wide fair has differed).
 * - On fair mode: fetches an expanded range (day.from − 30d → day.to + 1d) so
 *   allocated expenses whose windows overlap the focused day are included,
 *   then computes fairTotalForPeriod over the day's half-open range capped at
 *   tomorrow Jakarta midnight.
 * - Merges in-memory optimistic rows (temp-/optimistic- prefixed ids).
 * - Aborts on dayKey/mode/refreshKey change; on error/offline falls back to
 *   null so the caller displays the raw total.
 *
 * `now` is injectable for deterministic tests. In production the timestamp is
 * frozen on first render and re-captured only when `refreshKey` changes.
 */
export function useFairDayTotal(
  dayKey: string | null,
  mode: TotalMode,
  optimisticExpenses: Pick<ExpenseDto, "id" | "amount" | "occurredAt" | "allocationType">[],
  refreshKey: unknown = undefined,
  now: Date = new Date(),
): UseFairDayTotalResult {
  const [fairTotal, setFairTotal] = useState<number | null>(null);
  const [fairLoading, setFairLoading] = useState(false);
  const [hasAllocated, setHasAllocated] = useState(false);
  const [fairBreakdown, setFairBreakdown] = useState<FairBreakdown | null>(null);

  const inflightRef = useRef<AbortController | null>(null);

  const nowTimestampRef = useRef<number>(now.getTime());
  useLayoutEffect(() => {
    nowTimestampRef.current = now.getTime();
  }, [refreshKey, now]);

  const shouldFetch = mode === "fair" && dayKey !== null;

  // Build the civil day range for `dayKey` anchored at noon Jakarta to avoid
  // any timezone drift on the from/to computation.
  const dayRange = useMemo<PeriodRange | null>(() => {
    if (!dayKey) return null;
    const parts = dayKey.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts as [number, number, number];
    const anchorNoon = zonedWallTimeToUtc(APP_TIMEZONE, {
      year,
      month,
      day,
      hour: 12,
    });
    const civilParts = getZonedParts(anchorNoon, APP_TIMEZONE);
    const from = zonedWallTimeToUtc(APP_TIMEZONE, {
      year: civilParts.year,
      month: civilParts.month,
      day: civilParts.day,
    });
    const endCivil = addCivilDays(
      { year: civilParts.year, month: civilParts.month, day: civilParts.day },
      1,
    );
    const to = zonedWallTimeToUtc(APP_TIMEZONE, endCivil);
    return { from, to };
  }, [dayKey]);

  const fetchFair = useCallback(
    (signal: AbortSignal) => {
      if (!shouldFetch || !dayRange) return;
      setFairLoading(true);
      setFairTotal(null);
      setHasAllocated(false);
      setFairBreakdown(null);

      const frozenNow = new Date(nowTimestampRef.current);

      // Expanded window: 30 days before → day end (exclusive). The fair calc
      // itself only sums the focused day via fairTotalForPeriod.
      const expandedStart = addCivilDays(
        getZonedParts(dayRange.from, APP_TIMEZONE),
        -30,
      );
      const expandedFrom = zonedWallTimeToUtc(APP_TIMEZONE, expandedStart);

       expensesRepository
         .list(toIsoWithOffset(expandedFrom, APP_TIMEZONE), toIsoWithOffset(dayRange.to, APP_TIMEZONE))
        .then((response) => {
          if (signal.aborted) return;
          const serverIds = new Set(response.expenses.map((e) => e.id));
          const merged = [...response.expenses];
          for (const opt of optimisticExpenses) {
            if (!serverIds.has(opt.id)) merged.push(opt);
          }

          setHasAllocated(
            merged.some((e) => e.allocationType && e.allocationType !== "NONE"),
          );

          const total = fairTotalForPeriod(merged, dayRange, APP_TIMEZONE, frozenNow);
          if (!Number.isFinite(total)) return;
          setFairTotal(total);

          const breakdown = fairBreakdownForDay(
            merged,
            dayRange,
            APP_TIMEZONE,
            frozenNow,
          );
          setFairBreakdown(breakdown);
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
    [shouldFetch, dayRange, optimisticExpenses],
  );

  useEffect(() => {
    if (!shouldFetch || !dayRange) {
      inflightRef.current?.abort();
      setFairTotal(null);
      setFairLoading(false);
      setHasAllocated(false);
      setFairBreakdown(null);
      return;
    }
    const controller = new AbortController();
    inflightRef.current = controller;
    fetchFair(controller.signal);
    return () => controller.abort();
  }, [shouldFetch, dayRange, fetchFair, refreshKey]);

  return { fairTotal, fairLoading, hasAllocated, fairBreakdown };
}
