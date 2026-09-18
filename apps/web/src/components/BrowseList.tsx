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
 */
export function BrowseList({ rows, selectedKey, onSelect }: BrowseListProps) {
  return (
    <ul
      className="min-h-0 flex-1 divide-y divide-neutral-800/80 overflow-y-auto"
      data-testid="browse-list"
    >
      {rows.map((row) => {
        const selected = row.key === selectedKey;
        return (
          <li key={row.key}>
            <button
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
                {row.right}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
