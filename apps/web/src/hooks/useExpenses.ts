import { useCallback, useEffect, useRef, useState } from "react";

import type { ExpenseDto } from "@expense-app/shared";

import { expensesRepository } from "../lib/repository";
import { formatIDRAbbreviated } from "../lib/currency";
import { civilDayKey, loadTodayCache, saveTodayCache, type TodayCache } from "../lib/offlineDb";
import { currentPeriodRange, periodQuery, PERIOD_LABEL, APP_TIMEZONE } from "../lib/periods";
import type { Period, SpecialPanel, ViewMode } from "../types/ui";

export interface UseExpensesResult {
  period: Period;
  viewMode: ViewMode;
  /** In special mode: which panel is shown ("summary" or drill "detail"). */
  specialPanel: SpecialPanel;
  /** Selected browse key (chart bucket key or transaction id). */
  selectedKey: string | null;
  expenses: ExpenseDto[];
  total: number;
  totalLabel: string;
  periodLabel: string;
  loading: boolean;
  error: string | null;
  /** Server data is unavailable — UI is showing the cached day snapshot. */
  showingCachedDay: boolean;
  /** True when the last day fetch failed at the network level (status 0). */
  dayFetchFailed: boolean;
  /** True when a W/M open was rejected because the app is offline. */
  wmOfflineRejected: boolean;
  /** Open the special browse for `next`; resets panel + selection. */
  openHistory: (next: Period) => void;
  /** Return to the default calculator (period resets to "day"). */
  closeHistory: () => void;
  setViewMode: (mode: ViewMode) => void;
  setSelectedKey: (key: string | null) => void;
  enterDrill: () => void;
  exitDrill: () => void;
  clearError: () => void;
  refresh: () => void;
  applyOptimisticCreate: (expense: ExpenseDto) => void;
  revertOptimisticCreate: (expense: ExpenseDto) => void;
  applyOptimisticUpdate: (expense: ExpenseDto) => void;
  applyOptimisticDelete: (id: string) => { hadListEntry: boolean };
  /** Swap a local optimistic row id for the outbox temp id (stale-safe). */
  renameExpenseId: (from: string, to: string) => void;
  /** Track which expense ids carry unsynced local mutations (badge N). */
  markPending: (id: string) => void;
  pendingIds: Set<string>;
}

export function useExpenses(): UseExpensesResult {
  const [period, setPeriodState] = useState<Period>("day");
  const [viewMode, setViewMode] = useState<ViewMode>("calculator");
  const [specialPanel, setSpecialPanel] = useState<SpecialPanel>("summary");
  const [selectedKey, setSelectedKeyState] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showingCachedDay, setShowingCachedDay] = useState(false);
  const [dayFetchFailed, setDayFetchFailed] = useState(false);
  const [wmOfflineRejected, setWmOfflineRejected] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const reloadIdRef = useRef(0);
  const inflightRef = useRef<AbortController | null>(null);

  const markPending = useCallback((id: string) => {
    setPendingIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;

    const reloadId = ++reloadIdRef.current;
    setLoading(true);
    const { from, to } = periodQuery(period);
    const nowIso = new Date().toISOString();
    const dayKey = civilDayKey(nowIso);

    expensesRepository
      .list(from, to)
      .then((response) => {
        if (reloadIdRef.current !== reloadId) return;
        setExpenses(response.expenses.slice().sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()));
        setTotal(response.total);
        setError(null);
        setShowingCachedDay(false);
        setDayFetchFailed(false);
        setWmOfflineRejected(false);
        if (period === "day") {
          void saveTodayCache({
            expenses: response.expenses,
            total: response.total,
            dayKey,
            from,
            to,
            occurredAt: nowIso,
          });
        }
      })
       .catch(async (cause: unknown) => {
        if (reloadIdRef.current !== reloadId) return;
        const status = (cause as { status?: number }).status ?? 0;
        if (status === 0) {
          // Network failure: fall back to cached data.
          if (period === "day") {
            setDayFetchFailed(true);
          } else {
            // W/M offline: don't mark day fetch failed (spec §Adv-4).
            setDayFetchFailed(false);
          }
          if (period === "day") {
            const cache: TodayCache | null = await loadTodayCache();
            if (reloadIdRef.current !== reloadId) return;
            // Merge strategy: the cache is the base snapshot; in-memory rows
            // that are not in it (optimistic/temp rows created offline, or
            // rows just applied by the failed fetch itself) win — the outbox
            // holds newer truth than the last successful server read.
            if (cache && cache.dayKey === dayKey) {
              setExpenses((current) => {
                const known = new Set(cache.expenses.map((item) => item.id));
                const extras = current.filter((item) => !known.has(item.id));
                const merged = [...extras, ...cache.expenses].sort(
                  (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
                );
                setTotal((t) => t + extras.reduce((sum, item) => sum + item.amount, 0));
                return merged;
              });
              setShowingCachedDay(true);
              setError(null);
              return;
            }
            // No usable cache: keep whatever in-memory state we already have
            // (e.g. optimistic rows just created offline) instead of wiping it.
            setError(null);
            setShowingCachedDay(true);
            return;
          }
          // W/M offline (expanded): compute from in-memory + cache best-effort.
          // (spec §Adv-4: jangan blokir, hitung dari cache)
          const cache: TodayCache | null = await loadTodayCache();
          if (reloadIdRef.current !== reloadId) return;
          if (cache) {
            // Merge existing in-memory expenses with cache for best-effort W/M.
            setExpenses((current) => {
              const known = new Set(cache.expenses.map((item) => item.id));
              const extras = current.filter((item) => !known.has(item.id));
              const merged = [...extras, ...cache.expenses].sort(
                (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
              );
              // Raw total as-is: sum amounts whose occurredAt falls in [from, to).
              const range = currentPeriodRange(period);
              const fromMs = range.from.getTime();
              const toMs = range.to.getTime();
              const computedTotal = merged.reduce(
                (sum, item) => {
                  const t = new Date(item.occurredAt).getTime();
                  return t >= fromMs && t < toMs ? sum + item.amount : sum;
                },
                0,
              );
              setTotal(computedTotal);
              return merged;
            });
            setShowingCachedDay(true);
            setError(null);
            return;
          }
          // No cache at all: keep existing in-memory state (limited offline).
          setShowingCachedDay(true);
          setError(null);
          return;
        }
        setError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
      })
      .finally(() => {
        if (reloadIdRef.current === reloadId) setLoading(false);
      });
  }, [period]);

  useEffect(() => {
    refresh();
    return () => inflightRef.current?.abort();
  }, [refresh]);

  /** Open the special browse view for `next`; resets panel + selection.
   *  (spec §Adv-4: Expanded W/M — don't block offline, compute from cache best-effort) */
  const openHistory = useCallback((next: Period) => {
    setWmOfflineRejected(false);
    setPeriodState(next);
    setViewMode("special");
    setSpecialPanel("summary");
    setSelectedKeyState(null);
  }, []);

  /** Return to the default calculator (period always resets to "day"). */
  const closeHistory = useCallback(() => {
    setPeriodState("day");
    setViewMode("calculator");
    setSpecialPanel("summary");
    setSelectedKeyState(null);
  }, []);

  const setViewModeExternal = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setSpecialPanel("summary");
    setSelectedKeyState(null);
  }, []);

  const setSelectedKey = useCallback((key: string | null) => {
    setSelectedKeyState(key);
  }, []);

  /** Drill into the selected bucket's transactions. */
  const enterDrill = useCallback(() => {
    setSpecialPanel("drill");
  }, []);

  /** Back from drill to the summary list. */
  const exitDrill = useCallback(() => {
    setSpecialPanel("summary");
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const applyOptimisticCreate = useCallback((expense: ExpenseDto) => {
    setExpenses((current) =>
      [expense, ...current].sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      ),
    );
    setTotal((current) => current + expense.amount);
    setError(null);
  }, []);

  const revertOptimisticCreate = useCallback((expense: ExpenseDto) => {
    setExpenses((current) => current.filter((item) => item.id !== expense.id));
    setTotal((current) => current - expense.amount);
  }, []);

  const applyOptimisticUpdate = useCallback((expense: ExpenseDto) => {
    setExpenses((current) => {
      const previous = current.find((item) => item.id === expense.id);
      if (previous) {
        setTotal((t) => t - previous.amount + expense.amount);
      }
      return current.map((item) => (item.id === expense.id ? expense : item));
    });
  }, []);

  const applyOptimisticDelete = useCallback((id: string) => {
    let hadListEntry = false;
    setExpenses((current) => {
      const previous = current.find((item) => item.id === id);
      if (previous) {
        hadListEntry = true;
        setTotal((t) => t - previous.amount);
      }
      return current.filter((item) => item.id !== id);
    });
    return { hadListEntry };
  }, []);

  /** Swap a local optimistic row id for the outbox temp id. Functional so it
   * never suffers the stale-closure problem of capture-at-call-time lists. */
  const renameExpenseId = useCallback((from: string, to: string) => {
    setExpenses((current) => current.map((item) => (item.id === from ? { ...item, id: to } : item)));
  }, []);

  const totalLabel = formatIDRAbbreviated(total);
  const periodLabel = PERIOD_LABEL[period];

  return {
    period,
    viewMode,
    specialPanel,
    selectedKey,
    expenses,
    total,
    totalLabel,
    periodLabel,
    loading,
    error,
    showingCachedDay,
    dayFetchFailed,
    wmOfflineRejected,
    openHistory,
    closeHistory,
    setViewMode: setViewModeExternal,
    setSelectedKey,
    enterDrill,
    exitDrill,
    clearError,
    refresh,
    applyOptimisticCreate,
    revertOptimisticCreate,
    applyOptimisticUpdate,
    applyOptimisticDelete,
    renameExpenseId,
    markPending,
    pendingIds,
  };
}
