import type { BudgetSnapshot } from "@expense-app/shared";

import type { ChartBucket } from "../lib/chart";
import { BarChart } from "./BarChart";
import { BudgetInsight } from "./BudgetInsight";
import { GraphModeToggle, type GraphMode } from "./GraphModeToggle";

export interface GraphSectionProps {
  /** Whether an active budget exists — gates toggle visibility. */
  activeBudget: boolean;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;

  // Spending graph
  buckets: ChartBucket[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  title?: string;

  // Budget insight
  snapshot: BudgetSnapshot | { hasOverlap: false } | null;
}

/**
 * GraphSection (plan §8): composes the mode toggle (when a budget is active)
 * with either the existing BarChart (spending mode) or the BudgetInsight
 * (budget mode). Calculation lives outside this presentational component.
 */
export function GraphSection({
  activeBudget,
  mode,
  onModeChange,
  buckets,
  selectedKey,
  onSelect,
  title,
  snapshot,
}: GraphSectionProps) {
  return (
    <div data-testid="graph-section">
      {activeBudget && (
        <GraphModeToggle mode={mode} onModeChange={onModeChange} />
      )}

      {mode === "budget" && activeBudget ? (
        snapshot && "hasOverlap" in snapshot && !snapshot.hasOverlap ? (
          <div
            className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-6 text-center text-sm text-neutral-400"
            data-testid="budget-insight-no-overlap"
          >
            Tidak ada budget yang berlaku untuk periode ini.
          </div>
        ) : snapshot && "hasOverlap" in snapshot ? (
          <BudgetInsight snapshot={snapshot} />
        ) : null
      ) : (
        <BarChart buckets={buckets} selectedKey={selectedKey} onSelect={onSelect} title={title} />
      )}
    </div>
  );
}
