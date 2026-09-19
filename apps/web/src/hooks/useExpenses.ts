import { useCallback, useEffect, useRef, useState } from "react";

import type { ExpenseDto } from "@expense-app/shared";

import { expensesApi } from "../lib/api";
import { formatIDRAbbreviated } from "../lib/currency";
import { PERIOD_LABEL, periodQuery } from "../lib/periods";
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

  const reloadIdRef = useRef(0);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;

    const reloadId = ++reloadIdRef.current;
    setLoading(true);
    const { from, to } = periodQuery(period);

    expensesApi
      .list(from, to)
      .then((response) => {
        if (reloadIdRef.current !== reloadId) return;
        setExpenses(response.expenses.slice().sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()));
        setTotal(response.total);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (reloadIdRef.current !== reloadId) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save expense.\nTry again.",
        );
      })
      .finally(() => {
        if (reloadIdRef.current === reloadId) setLoading(false);
      });
  }, [period]);

  useEffect(() => {
    refresh();
    return () => inflightRef.current?.abort();
  }, [refresh]);

  /** Open the special browse view for `next`; resets panel + selection. */
  const openHistory = useCallback((next: Period) => {
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
  };
}
