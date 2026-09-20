import { formatIDRAbbreviated } from "../lib/currency";
import type { ChartBucket } from "../lib/chart";

export interface BarChartProps {
  buckets: ChartBucket[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  title?: string;
}

/**
 * Highlighted bar chart for the selected period (D/W/M).
 * The current day/hour is highlighted in emerald by default; when `selectedKey`
 * is provided browse selection takes over highlighting. Pure CSS flex bars —
 * no chart library.
 */
export function BarChart({ buckets, selectedKey, onSelect, title }: BarChartProps) {
  if (buckets.length === 0) return null;

  const max = Math.max(0, ...buckets.map((bucket) => bucket.total));
  const hasData = max > 0;

  const granularityLabel = buckets[0]?.kind === "hour" ? "Per jam" : "Per hari";

  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 pb-2 pt-3" data-testid="bar-chart">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-widest text-neutral-500">{granularityLabel}</span>
        {hasData ? (
          <span className="text-[11px] text-neutral-500">Puncak {formatIDRAbbreviated(max)}</span>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>

      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Pengeluaran ${granularityLabel.toLowerCase()}`}>
        {buckets.map((bucket) => {
          const heightPct = hasData ? Math.max(3, Math.round((bucket.total / max) * 100)) : 3;
          const highlighted = selectedKey ? bucket.key === selectedKey : bucket.isCurrent;
          return (
            <button
              key={bucket.key}
              type="button"
              onClick={() => onSelect?.(bucket.key)}
              data-testid={`bar-${bucket.key}`}
              title={`${bucket.key} • ${formatIDRAbbreviated(bucket.total)}`}
              className={`group flex min-w-0 flex-1 flex-col items-center justify-end ${onSelect ? "cursor-pointer" : "cursor-default"}`}
              style={{ height: "100%" }}
            >
              {highlighted && bucket.total > 0 && (
                <span className="mb-0.5 text-[9px] font-semibold text-emerald-300" data-testid={`bar-value-${bucket.key}`}>
                  {formatIDRAbbreviated(bucket.total).replace("Rp", "")}
                </span>
              )}
              <span
                className={`w-full rounded-sm transition-colors ${
                  highlighted
                    ? "bg-emerald-500"
                    : bucket.total > 0
                      ? "bg-[var(--bar-fill)] group-hover:brightness-110"
                      : "bg-[var(--bar-zero)]"
                }`}
                style={{ height: `${heightPct}%` }}
              />
            </button>
          );
        })}
      </div>

      {title && (
        <span
          className="mt-0.5 block text-[10px] text-neutral-400"
          data-testid="chart-title"
        >
          {title}
        </span>
      )}

      <div className="mt-1 flex gap-[3px]">
        {buckets.map((bucket) => (
          <span
            key={bucket.key}
            className={`flex-1 text-center text-[9px] ${
              selectedKey
                ? bucket.key === selectedKey
                  ? "font-bold text-emerald-300"
                  : "text-neutral-600"
                : bucket.isCurrent
                  ? "font-bold text-emerald-300"
                  : "text-neutral-600"
            }`}
          >
            {bucket.label}
          </span>
        ))}
      </div>
    </div>
  );
}
