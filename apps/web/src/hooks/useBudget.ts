import { useCallback, useEffect, useRef, useState } from "react";

import type { BudgetActiveResponse, BudgetHistoryItem, BudgetDayPoint } from "@expense-app/shared";

import { budgetsApi } from "../lib/api";

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
}

export function useBudget(): BudgetState {
  const [active, setActive] = useState<BudgetActiveResponse["budget"]>(null);
  const [history, setHistory] = useState<BudgetHistoryItem[]>([]);
  const [series, setSeries] = useState<BudgetDayPoint[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadIdRef = useRef(0);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;

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
    refresh();
    return () => inflightRef.current?.abort();
  }, [refresh]);

  const createBudget = useCallback(
    async (payload: {
      type: "full" | "daily";
      amount: number;
      startDate: string;
      endDate: string;
    }): Promise<boolean> => {
      try {
        await budgetsApi.create(payload);
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

  return { active, history, series, seriesLoading, loading, error, refresh, createBudget, removeBudget, getStatusNow };
}
