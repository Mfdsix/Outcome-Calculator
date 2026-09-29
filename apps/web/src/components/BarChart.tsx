import { formatIDR, formatIDRAbbreviated } from "../lib/currency";
import type { ChartBucket } from "../lib/chart";

export interface BarChartProps {
  buckets: ChartBucket[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  title?: string;
  /**
   * Signed budget delta for the visible period (remaining >= 0, overspent < 0).
   * When provided, the header shows only the [+/-] figure; when absent the
   * chart renders bare (no header row at all).
   */
  budgetDelta?: number | null;
  /**
   * Daily cap for over-budget marking (daily budgets only; null = off).
   * A bucket with total above cap × its day count renders faded red,
   * solid red when selected/highlighted. Month pairs cover 2 days
   * (via endKey) so their threshold is cap × 2.
   */
  overCap?: number | null;
}

/** Civil "YYYY-MM-DD" → UTC millis (for bucket day-count math). */
function civilToMs(key: string): number | null {
  const parts = key.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/**
 * How many civil days a bucket covers: 2 for month pairs ([key, endKey]),
 * 1 otherwise (single days, orphans, hour buckets).
 */
function bucketDayCount(bucket: ChartBucket): number {
  if (!bucket.endKey || bucket.endKey === bucket.key) return 1;
  const from = civilToMs(bucket.key);
  const to = civilToMs(bucket.endKey);
  if (from === null || to === null || to < from) return 1;
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * Highlighted bar chart for the selected period (D/W/M).
 * The current day/hour is highlighted in emerald by default; when `selectedKey`
 * is provided browse selection takes over highlighting. Pure CSS flex bars —
 * no chart library.
 */
export function BarChart({ buckets, selectedKey, onSelect, title, budgetDelta = null, overCap = null }: BarChartProps) {
  if (buckets.length === 0) return null;

  const max = Math.max(0, ...buckets.map((bucket) => bucket.total));
  const hasData = max > 0;

  const granularityLabel = buckets[0]?.kind === "hour" ? "Per jam" : "Per hari";

  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 pb-2 pt-3" data-testid="bar-chart">
      {budgetDelta !== null && (
        <div className="mb-2 flex items-center justify-start">
          <span
            data-testid="chart-budget-delta"
            className={`text-sm font-semibold tabular-nums ${budgetDelta >= 0 ? "text-emerald-300" : "text-red-300"}`}
          >
            {budgetDelta >= 0 ? `+${formatIDR(budgetDelta)}` : `−${formatIDR(-budgetDelta)}`}
          </span>
        </div>
      )}

      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Pengeluaran ${granularityLabel.toLowerCase()}`}>
        {buckets.map((bucket) => {
          const heightPct = hasData ? Math.max(3, Math.round((bucket.total / max) * 100)) : 3;
          const highlighted = selectedKey ? bucket.key === selectedKey : bucket.isCurrent;
          const over = overCap !== null && bucket.total > overCap * bucketDayCount(bucket);
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
                <span className={`mb-0.5 text-[9px] font-semibold ${over ? "text-red-300" : "text-emerald-300"}`} data-testid={`bar-value-${bucket.key}`}>
                  {formatIDRAbbreviated(bucket.total).replace("Rp", "")}
                </span>
              )}
              <span
                className={`w-full rounded-sm transition-colors ${
                  highlighted
                    ? over
                      ? "bg-red-500"
                      : "bg-emerald-500"
                    : over && bucket.total > 0
                      ? "bg-red-500/30"
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
        {buckets.map((bucket) => {
          const isActive = selectedKey ? bucket.key === selectedKey : bucket.isCurrent;
          const over = overCap !== null && bucket.total > overCap * bucketDayCount(bucket);
          return (
            <span
              key={bucket.key}
              className={`flex-1 text-center text-[9px] ${
                isActive
                  ? over
                    ? "font-bold text-red-300"
                    : "font-bold text-emerald-300"
                  : "text-neutral-600"
              }`}
            >
              {bucket.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
