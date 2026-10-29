import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BudgetActiveResponse, BudgetHistoryItem, BudgetDayPoint } from "@expense-app/shared";

import { budgetsApi } from "../lib/api";

export type BudgetListItem = NonNullable<BudgetActiveResponse["budget"]> | BudgetHistoryItem;

export interface BudgetState {
  /** Active budget + server-computed spent/remaining, or null. */
  active: BudgetActiveResponse["budget"];
  /** Past (deactivated) budgets, desc by createdAt. */
  history: BudgetHistoryItem[];
  /** Day-by-day spend series for the active budget (sparse), or null. */
  series: BudgetDayPoint[] | null;
  seriesLoading: boolean;
  loading: boolean;
  /** Soft error — never blocks the keypad (plan §4); shown via banner. */
  error: string | null;
  /** Fetch active + history + series (plan §4). */
  refresh: () => void;
  createBudget: (payload: {
    type: "full" | "daily";
    amount: number;
    startDate: string;
    endDate: string;
  }) => Promise<boolean>;
  removeBudget: () => Promise<boolean>;
  /**
   * Fresh server status for the active budget (post-Enter toast, plan §3:
   * feedback AFTER the amount is in). Resolves null when nothing is active
   * or the fetch fails — no toast either way, input stays saved.
   */
  getStatusNow: () => Promise<BudgetActiveResponse["budget"]>;

  // --- History navigation (budget plan §3) ---------------------------------

  /** Index into `list` — 0 = active (when one exists), then history desc. */
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  /** `[active, ...history]` (or just history when nothing is active). */
  list: BudgetListItem[];
  focused: BudgetListItem | null;
  /** True when the focused item is NOT the active budget. */
  focusedIsPast: boolean;
  /** Series of the focused past budget, or null until loaded. */
  focusedPastSeries: BudgetDayPoint[] | null;
  /** Cache of past series, keyed by budget id. */
  pastSeries: Record<string, BudgetDayPoint[]>;
  /** Id currently being fetched, or null. */
  pastSeriesLoading: string | null;
  pastSeriesError: string | null;
  retryPastSeries: () => void;
}

export function useBudget(): BudgetState {
  const [active, setActive] = useState<BudgetActiveResponse["budget"]>(null);
  const [history, setHistory] = useState<BudgetHistoryItem[]>([]);
  const [series, setSeries] = useState<BudgetDayPoint[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [focusedIndexRaw, setFocusedIndexRaw] = useState(0);
  const [pastSeries, setPastSeries] = useState<Record<string, BudgetDayPoint[]>>({});
  const [pastSeriesLoading, setPastSeriesLoading] = useState<string | null>(null);
  const [pastSeriesError, setPastSeriesError] = useState<string | null>(null);
  const [pastRetry, setPastRetry] = useState(0);

  const reloadIdRef = useRef(0);
  const inflightRef = useRef<AbortController | null>(null);
  const pastInflightRef = useRef<Map<string, AbortController>>(new Map());
  const mountedRef = useRef(true);

  const list = useMemo<BudgetListItem[]>(
    () => (active ? [active, ...history] : history),
    [active, history],
  );

  /** Clamp on read so a shrinking history never points past the end. */
  const focusedIndex = Math.min(focusedIndexRaw, Math.max(0, list.length - 1));
  const focused = list[focusedIndex] ?? null;
  const focusedIsPast = focused !== null && (active === null || focused.id !== active.id);

  const setFocusedIndex = useCallback((index: number) => {
    setFocusedIndexRaw(Math.max(0, Math.floor(index)));
  }, []);

  const refresh = useCallback(() => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;

    // Expense data may have changed → every cached past series is stale.
    // Abort in-flight fetches so the refocus effect starts them over.
    for (const past of pastInflightRef.current.values()) past.abort();
    pastInflightRef.current.clear();
    setPastSeries({});
    setPastSeriesLoading(null);
    setPastSeriesError(null);

    const reloadId = ++reloadIdRef.current;
    setLoading(true);
    setSeriesLoading(true);

    // The day series is best-effort: it must never fail the whole refresh
    // (offline, older mocks, or endpoint drift → null → dashboard hidden).
    // Wrapped in Promise.resolve().then so even a synchronous throw degrades
    // to null instead of crashing the refresh.
    const seriesPromise: Promise<BudgetDayPoint[] | null> = Promise.resolve()
      .then(() => budgetsApi.activeSeries())
      .then((response) => response.days)
      .catch(() => null);

    // Three parallel requests (plan §4: simple over clever).
    Promise.all([budgetsApi.getActive(), budgetsApi.history(), seriesPromise])
      .then(([activeResponse, historyResponse, seriesResponse]) => {
        if (reloadIdRef.current !== reloadId) return;
        setActive(activeResponse.budget);
        setHistory(historyResponse.history);
        setSeries(seriesResponse);
        setSeriesLoading(false);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (reloadIdRef.current !== reloadId) return;
        setSeries(null);
        setSeriesLoading(false);
        setError(cause instanceof Error ? cause.message : "Gagal memuat budget.");
      })
      .finally(() => {
        if (reloadIdRef.current === reloadId) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
      inflightRef.current?.abort();
      for (const past of pastInflightRef.current.values()) past.abort();
      pastInflightRef.current.clear();
    };
  }, [refresh]);

  /** Clamp the focused index whenever the list shrinks (history changes). */
  useEffect(() => {
    setFocusedIndexRaw((current) =>
      current >= list.length ? Math.max(0, list.length - 1) : current,
    );
  }, [list.length]);

  /**
   * Fetch the focused past budget's series on demand, once per id. The cache
   * survives navigation; refresh() invalidates it. No cleanup abort on
   * dependency changes — an in-flight result is still useful for the cache.
   */
  useEffect(() => {
    if (!focusedIsPast || focused === null) return;
    const id = focused.id;
    if (pastSeries[id] !== undefined) return;
    if (pastInflightRef.current.has(id)) return;

    const controller = new AbortController();
    pastInflightRef.current.set(id, controller);
    setPastSeriesLoading(id);
    setPastSeriesError(null);

    budgetsApi
      .seriesById(id, controller.signal)
      .then((response) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setPastSeries((prev) => ({ ...prev, [id]: response.days }));
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setPastSeriesError(
          cause instanceof Error ? cause.message : "Gagal memuat riwayat budget.",
        );
      })
      .finally(() => {
        if (pastInflightRef.current.get(id) === controller) {
          pastInflightRef.current.delete(id);
        }
        if (mountedRef.current && !controller.signal.aborted) {
          setPastSeriesLoading((current) => (current === id ? null : current));
        }
      });
  }, [focusedIsPast, focused, pastSeries, pastRetry]);

  const retryPastSeries = useCallback(() => {
    for (const past of pastInflightRef.current.values()) past.abort();
    pastInflightRef.current.clear();
    setPastSeries({});
    setPastSeriesLoading(null);
    setPastSeriesError(null);
    setPastRetry((value) => value + 1);
  }, []);

  const createBudget = useCallback(
    async (payload: {
      type: "full" | "daily";
      amount: number;
      startDate: string;
      endDate: string;
    }): Promise<boolean> => {
      try {
        await budgetsApi.create(payload);
        setFocusedIndexRaw(0);
        refresh();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Gagal menyimpan budget.");
        return false;
      }
    },
    [refresh],
  );

  const removeBudget = useCallback(async (): Promise<boolean> => {
    try {
      await budgetsApi.remove();
      refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menghapus budget.");
      return false;
    }
  }, [refresh]);

  const getStatusNow = useCallback(
    async (): Promise<BudgetActiveResponse["budget"]> => {
      try {
        const response = await budgetsApi.getActive();
        return response.budget;
      } catch {
        return null; // soft: toast is best-effort, never an error banner
      }
    },
    [],
  );

  const focusedPastSeries =
    focusedIsPast && focused !== null ? (pastSeries[focused.id] ?? null) : null;

  return {
    active,
    history,
    series,
    seriesLoading,
    loading,
    error,
    refresh,
    createBudget,
    removeBudget,
    getStatusNow,
    focusedIndex,
    setFocusedIndex,
    list,
    focused,
    focusedIsPast,
    focusedPastSeries,
    pastSeries,
    pastSeriesLoading,
    pastSeriesError,
    retryPastSeries,
  };
}
