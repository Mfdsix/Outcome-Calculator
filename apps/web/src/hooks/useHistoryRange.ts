import { useEffect, useRef, useState } from "react";

import type { ExpenseDto } from "@expense-app/shared";

import { expensesRepository } from "../lib/repository";
import { periodQuery } from "../lib/periods";
import type { Period } from "../types/ui";

export interface UseHistoryRangeResult {
  /** Expenses within the W/M period, newest first. Empty for "day". */
  expenses: ExpenseDto[];
  /** Server total for the period (raw sum). */
  total: number;
  loading: boolean;
  /** Last fetch failed at the network level (status 0). */
  offline: boolean;
}

/**
 * W/M expense range for the wide-screen HistoryPane, independent from the
 * calculator's always-day list (useExpenses keeps `period === "day"` on wide
 * so the home column never loses today's data). "day" is served from the
 * shared today list — this hook fetches nothing for it.
 *
 * Refetches when `refreshKey` changes (CRUD signature from the live list) so
 * the pane stays in sync with edits made on the calculator column. Previous
 * rows stay visible while refetching; a network failure keeps them and flips
 * `offline` (the pane shows the "Butuh internet" hint).
 */
export function useHistoryRange(period: Period, refreshKey: string): UseHistoryRangeResult {
  const wantsFetch = period !== "day";
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const reloadIdRef = useRef(0);

  useEffect(() => {
    if (!wantsFetch) return;
    const reloadId = ++reloadIdRef.current;
    setLoading(true);
    setOffline(false);
    const { from, to } = periodQuery(period);

    expensesRepository
      .list(from, to)
      .then((response) => {
        if (reloadIdRef.current !== reloadId) return;
        setExpenses(
          response.expenses
            .slice()
            .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
        );
        setTotal(response.total);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (reloadIdRef.current !== reloadId) return;
        // Network-level failure (status 0) → offline hint; server errors keep
        // the previous rows visible without flagging the connection.
        const status = (cause as { status?: number }).status ?? 0;
        setOffline(status === 0);
        setLoading(false);
      });
  }, [period, wantsFetch, refreshKey]);

  return { expenses, total, loading, offline };
}
