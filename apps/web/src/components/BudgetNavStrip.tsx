export interface BudgetNavStripProps {
  /** Number of budgets in the focused list (active + history). */
  count: number;
  activeIndex: number;
  /** One label per index (index 0 = active, then history desc). */
  labels: string[];
  onSelect: (index: number) => void;
  /** Hidden when there is nothing to navigate (count <= 1). */
  hidden?: boolean;
}

/**
 * Layer 1b (wireframe §4) — ‹ dots › between the top bar and the focused
 * card. Only moves `focusedIndex`; no data is mutated on the server.
 */
export function BudgetNavStrip({ count, activeIndex, labels, onSelect, hidden }: BudgetNavStripProps) {
  if (hidden || count <= 1) return null;

  const atStart = activeIndex <= 0;
  const atEnd = activeIndex >= count - 1;
  const navButton =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-300 active:bg-neutral-800 disabled:opacity-40";

  return (
    <div
      data-testid="budget-nav"
      className="flex items-center gap-2 pb-2"
      role="group"
      aria-label="Navigasi budget"
    >
      <button
        type="button"
        data-testid="budget-nav-prev"
        aria-label="Budget sebelumnya"
        disabled={atStart}
        onClick={() => onSelect(activeIndex - 1)}
        className={navButton}
      >
        ‹
      </button>

      <div className="min-w-0 flex-1 text-center">
        <p
          data-testid="budget-nav-label"
          className="truncate text-xs text-neutral-400"
          title={labels[activeIndex] ?? ""}
        >
          {labels[activeIndex] ?? ""}
        </p>
        <div
          role="tablist"
          aria-label="Daftar budget"
          className="mt-1 flex items-center justify-center gap-1.5"
        >
          {Array.from({ length: count }, (_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={labels[index] ?? `Budget ${index + 1}`}
              data-testid={`budget-nav-dot-${index}`}
              onClick={() => onSelect(index)}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                index === activeIndex ? "bg-emerald-400" : "bg-neutral-700"
              }`}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        data-testid="budget-nav-next"
        aria-label="Budget berikutnya"
        disabled={atEnd}
        onClick={() => onSelect(activeIndex + 1)}
        className={navButton}
      >
        ›
      </button>
    </div>
  );
}
