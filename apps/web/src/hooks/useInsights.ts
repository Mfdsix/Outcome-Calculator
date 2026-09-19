import { useMemo } from "react";

import type { Insight, InsightInput } from "@expense-app/shared";
import { buildInsights } from "@expense-app/shared";

import { APP_TIMEZONE } from "../lib/periods";

export interface UseInsightsResult {
  /** Ordered insights (over > warning > pace > ok > no-budget); never empty. */
  insights: Insight[];
}

/**
 * Derive insights from data the calculator already holds — the active budget
 * snapshot (server-computed spent) and the live today total (optimistic +
 * offline-cache). No fetch, no state: a pure memo over both inputs, so it
 * updates the moment expenses or the budget change.
 */
export function useInsights(
  active: InsightInput["active"],
  todayTotal: number,
): UseInsightsResult {
  const insights = useMemo(
    () => buildInsights({ active, todayTotal, now: new Date(), timeZone: APP_TIMEZONE }),
    [active, todayTotal],
  );
  return { insights };
}
