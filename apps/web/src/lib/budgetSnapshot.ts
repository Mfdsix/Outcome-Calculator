import { useMemo } from "react";

import { buildBudgetSnapshot } from "@expense-app/shared";
import type { BudgetSnapshot } from "@expense-app/shared";

import { APP_TIMEZONE, currentPeriodRange } from "./periods";
import type { Period } from "../types/ui";

/**
 * Derive a BudgetSnapshot for the visible D/W/M period from already-fetched
 * period expenses + the active budget. Zero new API calls — just client-side
 * intersection math over the seam in packages/shared (allocation engine plugs
 * in later without touching callers).
 */
export function useBudgetSnapshot(
  period: Period,
  expenses: Parameters<typeof buildBudgetSnapshot>[2],
  activeBudget: Parameters<typeof buildBudgetSnapshot>[0] | null,
): BudgetSnapshot | { hasOverlap: false } | null {
  const range = useMemo(() => currentPeriodRange(period), [period]);

  return useMemo(() => {
    if (!activeBudget) return null;
    return buildBudgetSnapshot(activeBudget, range, expenses, APP_TIMEZONE);
  }, [activeBudget, range, expenses]);
}
