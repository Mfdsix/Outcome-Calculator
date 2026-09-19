import { memo } from "react";

import type { BrowseRow } from "./BrowseList";
import { useScrollSelected } from "./useScrollSelected";

export interface SummaryListProps {
  rows: BrowseRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/**
 * Compact ledger rows for special browse mode (spec plan §2).
 * Label on the left, amount on the right. Selection highlights the row and
 * auto-scrolls it into view (useScrollSelected).
 */
export const SummaryList = memo(function SummaryList({ rows, selectedKey, onSelect }: SummaryListProps) {
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
        return (
          <SummaryRow
            key={row.key}
            row={row}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        );
      })}
    </ul>
  );
});

interface SummaryRowProps {
  row: BrowseRow;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function SummaryRow({ row, selectedKey, onSelect }: SummaryRowProps) {
  const selected = row.key === selectedKey;
  const rowRef = useScrollSelected(selectedKey);
      return (
    <li key={row.key}>
      <button
        ref={selected ? rowRef : undefined}
        type="button"
        onClick={() => onSelect(row.key)}
        data-testid={`summary-row-${row.key}`}
        aria-pressed={selected}
        className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-2 px-1 py-2.5 text-left transition-colors ${
          selected ? "bg-neutral-800/80" : "active:bg-neutral-900"
        }`}
      >
        <span className={`col-span-1 text-sm ${selected ? "font-semibold text-neutral-100" : "text-neutral-400"}`}>
          {row.left}
        </span>
        {row.mid && (
          <span className={`col-span-1 text-right text-sm ${selected ? "font-semibold text-neutral-100" : "text-neutral-500"}`}>
            {row.mid}
          </span>
        )}
        <span className={`col-span-1 text-right tabular-nums ${selected ? "font-semibold text-neutral-50" : "text-neutral-300"}`}>
          {row.right}
        </span>
      </button>
    </li>
  );
}
