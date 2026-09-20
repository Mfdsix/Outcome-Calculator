import { useCallback, useEffect, useRef, useState } from "react";

import type { BudgetActiveResponse, BudgetHistoryItem } from "@expense-app/shared";

import { budgetsApi } from "../lib/api";
import { IS_TAURI } from "../lib/tauri";

export interface BudgetState {
  /** Active budget + server-computed spent/remaining, or null. */
  active: BudgetActiveResponse["budget"];
  /** Past (deactivated) budgets, desc by createdAt. */
  history: BudgetHistoryItem[];
  loading: boolean;
  /** Soft error — never blocks the keypad (plan §4); shown via banner. */
  error: string | null;
  /** Fetch active + history (2 parallel requests — plan §4). */
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadIdRef = useRef(0);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    // Native build: budgets are a backend feature (plan §3 — no budgets in
    // the local MVP); the screen is hidden and the hook stays a stub.
    if (IS_TAURI) return;
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;

    const reloadId = ++reloadIdRef.current;
    setLoading(true);

    // Two parallel requests (plan §4: simple over clever).
    Promise.all([budgetsApi.getActive(), budgetsApi.history()])
      .then(([activeResponse, historyResponse]) => {
        if (reloadIdRef.current !== reloadId) return;
        setActive(activeResponse.budget);
        setHistory(historyResponse.history);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (reloadIdRef.current !== reloadId) return;
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
      if (IS_TAURI) return false;
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
    if (IS_TAURI) return false;
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
      if (IS_TAURI) return null; // soft: toast is best-effort, never an error banner
      try {
        const response = await budgetsApi.getActive();
        return response.budget;
      } catch {
        return null; // soft: toast is best-effort, never an error banner
      }
    },
    [],
  );

  return { active, history, loading, error, refresh, createBudget, removeBudget, getStatusNow };
}
