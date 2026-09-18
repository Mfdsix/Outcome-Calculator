import { groupDigits } from "../lib/currency";
import type { BrowseRow } from "./BrowseList";

export interface SummaryListProps {
  rows: BrowseRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/**
 * Compact ledger rows for special browse mode (spec plan §2).
 * Date on the left, amount on the right. Selection highlights
 * the row with a neutral marker.
 */
export function SummaryList({ rows, selectedKey, onSelect }: SummaryListProps) {
  if (rows.length === 0) {
    return (
      <div className="min-h-0 flex-1" data-testid="summary-empty">
        <p className="py-4 text-center text-sm text-neutral-500">No data yet.</p>
      </div>
    );
  }

  return (
    <ul
      className="min-h-0 flex-1 divide-y divide-neutral-800/80 overflow-y-auto"
      data-testid="summary-list"
    >
      {rows.map((row) => {
        const selected = row.key === selectedKey;
        return (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onSelect(row.key)}
              data-testid={`summary-row-${row.key}`}
              aria-pressed={selected}
              className={`flex w-full items-center justify-between px-1 py-2.5 text-left transition-colors ${
                selected ? "bg-neutral-800/80" : "active:bg-neutral-900"
              }`}
            >
              <span className={`text-sm ${selected ? "font-semibold text-neutral-100" : "text-neutral-400"}`}>
                {row.left}
              </span>
              {row.mid && (
                <span className={`text-sm ${selected ? "font-semibold text-neutral-100" : "text-neutral-500"}`}>
                  {row.mid}
                </span>
              )}
              <span className={`tabular-nums ${selected ? "font-semibold text-neutral-50" : "text-neutral-300"}`}>
                {row.right}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
