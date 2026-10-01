import type { BudgetSnapshot } from "@expense-app/shared";

import type { ChartBucket } from "../lib/chart";
import { BarChart } from "./BarChart";

export interface GraphSectionProps {
  // Spending graph
  buckets: ChartBucket[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  title?: string;

  // Budget overlay (null = no budget → bare chart)
  snapshot: BudgetSnapshot | { hasOverlap: false } | null;

  /** Daily cap for over-day marking (daily budgets only; null = off). */
  dailyCap?: number | null;

  /** When true and buckets are empty, BarChart shows a shimmer. */
  loading?: boolean;
}

/**
 * GraphSection: always the spending BarChart. When the active budget
 * overlaps the visible D/W/M period, the chart header shows the signed
 * [+/-] delta instead; otherwise the chart renders bare (no header row).
 * No mode toggle — one view only.
 */
export function GraphSection({
  buckets,
  selectedKey,
  onSelect,
  title,
  snapshot,
  dailyCap = null,
  loading = false,
}: GraphSectionProps) {
  const budgetDelta =
    snapshot !== null && "remaining" in snapshot
      ? snapshot.overspent > 0
        ? -snapshot.overspent
        : snapshot.remaining
      : null;

  return (
    <div data-testid="graph-section">
      <BarChart
        buckets={buckets}
        selectedKey={selectedKey}
        onSelect={onSelect}
        title={title}
        budgetDelta={budgetDelta}
        overCap={dailyCap}
        loading={loading}
      />
    </div>
  );
}
