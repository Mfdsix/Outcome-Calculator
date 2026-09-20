import { memo } from "react";

import { useScrollSelected } from "./useScrollSelected";

export interface BrowseRow {
  key: string;
  left: string;
  mid?: string;
  right: string;
  id?: string;
}

export interface BrowseListProps {
  rows: BrowseRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/**
 * Scrollable list of rows beneath the chart. Used in both browse mode (date or
 * transaction rows) and drill-down mode (transactions for a selected day).
 * Selection auto-scrolls into view.
 */
export const BrowseList = memo(function BrowseList({ rows, selectedKey, onSelect }: BrowseListProps) {
  return (
    <ul
      className="min-h-0 flex-1 divide-y-0 overflow-y-auto"
      data-testid="browse-list"
    >
      {rows.map((row) => {
        return (
          <BrowseRowItem
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

interface BrowseRowItemProps {
  row: BrowseRow;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function BrowseRowItem({ row, selectedKey, onSelect }: BrowseRowItemProps) {
  const selected = row.key === selectedKey;
  const rowRef = useScrollSelected(selectedKey);
  return (
    <li key={row.key}>
      <button
        ref={selected ? rowRef : undefined}
        type="button"
        onClick={() => onSelect(row.key)}
        data-testid={`browse-row-${row.key}`}
        aria-pressed={selected}
        className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-2 px-1 py-3 text-left focus-visible:outline-none focus-visible:ring-0 transition-colors ${
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
