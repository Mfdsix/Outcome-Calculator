import { memo } from "react";

import { useScrollSelected } from "./useScrollSelected";

export interface BrowseRow {
  key: string;
  left: string;
  mid?: string;
  right: string;
  id?: string;
  /** True when this row carries an unsynced offline mutation (badge N). */
  pending?: boolean;
}

export interface BrowseListProps {
  rows: BrowseRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/** Amber dot marking a row with an unsynced offline mutation. */
export const PendingDot = memo(function PendingDot() {
  return (
    <span
      aria-hidden="true"
      data-testid="pending-dot"
      className="mr-1.5 inline-block size-1.5 rounded-full bg-yellow-400 align-middle"
    />
  );
});

/**
 * Scrollable list of rows beneath the chart. Used in both browse mode (date or
 * transaction rows) and drill-down mode (transactions for a selected day).
 * Selection auto-scrolls into view.
 */
export const BrowseList = memo(function BrowseList({ rows, selectedKey, onSelect }: BrowseListProps) {
  return (
    <ul
      className="min-h-0 flex-1 divide-y divide-neutral-800/80 overflow-y-auto"
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
        className={`flex w-full items-center justify-between px-1 py-3 text-left transition-colors ${
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
          {row.pending && <PendingDot />}
          {row.right}
        </span>
      </button>
    </li>
  );
}
