import { formatIDR, formatIDRAbbreviated } from "../lib/currency";
import type { ChartBucket } from "../lib/chart";
import { useChartMode } from "../lib/chartMode";
import { ChartModeToggle } from "./ChartModeToggle";

export interface BarChartProps {
  buckets: ChartBucket[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  title?: string;
  /**
   * Signed budget delta for the visible period (remaining >= 0, overspent < 0).
   * When provided, the header shows the [+/-] figure on the left.
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

/** Over threshold for one bucket (null = marking off). */
function bucketThreshold(bucket: ChartBucket, overCap: number | null): number | null {
  if (overCap === null) return null;
  return overCap * bucketDayCount(bucket);
}

/**
 * Highlighted bar chart for the selected period (D/W/M), with a toggle
 * to switch to an up-down line view and back. The current day/hour is
 * highlighted in emerald by default; when `selectedKey` is provided browse
 * selection takes over highlighting. Pure CSS/SVG — no chart library.
 */
export function BarChart({ buckets, selectedKey, onSelect, title, budgetDelta = null, overCap = null }: BarChartProps) {
  // Persisted bar ↔ line preference (same pattern as theme state).
  const [chartMode, toggleChartMode] = useChartMode("expense-app.chart-mode", "bar");
  const lineMode = chartMode === "line";

  if (buckets.length === 0) return null;

  const max = Math.max(0, ...buckets.map((bucket) => bucket.total));
  const hasData = max > 0;

  const granularityLabel = buckets[0]?.kind === "hour" ? "Per jam" : "Per hari";

  /**
   * Day-mode red rule: cumulative spending through each hour versus the
   * daily cap — e.g. 35rb → 60rb (green, green), then 102rb → 127,5rb
   * (red, red) on an 85rb cap. W/M keep the per-bucket cap × days rule.
   */
  const isHourMode = buckets[0]?.kind === "hour";
  let runningTotal = 0;
  const cumulative = buckets.map((bucket) => {
    runningTotal += bucket.total;
    return runningTotal;
  });
  const isHourOver = (index: number): boolean =>
    overCap !== null && isHourMode && (cumulative[index] ?? 0) > overCap;

  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 pb-2 pt-3" data-testid="bar-chart">
      <div className="mb-2 flex items-center justify-between">
        {budgetDelta !== null ? (
          <span
            data-testid="chart-budget-delta"
            className={`text-sm font-semibold tabular-nums ${budgetDelta >= 0 ? "text-emerald-300" : "text-red-300"}`}
          >
            {budgetDelta >= 0 ? `+${formatIDR(budgetDelta)}` : `−${formatIDR(-budgetDelta)}`}
          </span>
        ) : (
          <span aria-hidden="true" />
        )}
        <ChartModeToggle mode={chartMode} onToggle={toggleChartMode} testid="chart-mode-toggle" />
      </div>

      {lineMode ? (
        <SpendingLine buckets={buckets} selectedKey={selectedKey} onSelect={onSelect} overCap={overCap} cumulative={isHourMode ? cumulative : null} />
      ) : (
        <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Pengeluaran ${granularityLabel.toLowerCase()}`}>
          {buckets.map((bucket, index) => {
            const heightPct = hasData ? Math.max(3, Math.round((bucket.total / max) * 100)) : 3;
            const highlighted = selectedKey ? bucket.key === selectedKey : bucket.isCurrent;
            const threshold = bucketThreshold(bucket, overCap);
            const over = isHourMode
              ? isHourOver(index)
              : threshold !== null && bucket.total > threshold;
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
      )}

      {title && (
        <span
          className="mt-0.5 block text-[10px] text-neutral-400"
          data-testid="chart-title"
        >
          {title}
        </span>
      )}

      <div className="mt-1 flex gap-[3px]">
        {buckets.map((bucket, index) => {
          const isActive = selectedKey ? bucket.key === selectedKey : bucket.isCurrent;
          const threshold = bucketThreshold(bucket, overCap);
          const over = isHourMode
            ? isHourOver(index)
            : threshold !== null && bucket.total > threshold;
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

const LINE_W = 100;
const LINE_H = 48;

/** Up-down line view of the same buckets (totals, bottom baseline). */
function SpendingLine({
  buckets,
  selectedKey,
  onSelect,
  overCap,
  cumulative,
}: {
  buckets: ChartBucket[];
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  overCap: number | null;
  /** Prefix sums for hour mode (null = per-bucket rule). */
  cumulative: number[] | null;
}) {
  const max = Math.max(0, ...buckets.map((bucket) => bucket.total));
  const x = (i: number): number => (buckets.length === 1 ? LINE_W / 2 : (i / (buckets.length - 1)) * LINE_W);
  const y = (total: number): number => (max > 0 ? LINE_H - 3 - (total / max) * (LINE_H - 6) : LINE_H - 3);
  const isActive = (bucket: ChartBucket): boolean =>
    selectedKey ? bucket.key === selectedKey : bucket.isCurrent;
  const isOver = (bucket: ChartBucket, index: number): boolean => {
    if (cumulative !== null) return overCap !== null && (cumulative[index] ?? 0) > overCap;
    const threshold = bucketThreshold(bucket, overCap);
    return threshold !== null && bucket.total > threshold;
  };
  // Segments turn red once either endpoint crosses (the crossing segment
  // itself reads red, everything after stays red).
  const segOver = (a: ChartBucket, ai: number, b: ChartBucket, bi: number): boolean =>
    isOver(a, ai) || isOver(b, bi);

  return (
    <svg
      viewBox={`0 0 ${LINE_W} ${LINE_H}`}
      preserveAspectRatio="none"
      className="h-24 w-full"
      role="img"
      aria-label="Grafik garis pengeluaran"
      data-testid="spending-line"
    >
      {buckets.slice(0, -1).map((bucket, i) => {
        const next = buckets[i + 1]!;
        const red = segOver(bucket, i, next, i + 1);
        return (
          <line
            key={bucket.key}
            x1={x(i)}
            y1={y(bucket.total)}
            x2={x(i + 1)}
            y2={y(next.total)}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            className={red ? "stroke-red-500" : "stroke-emerald-500"}
          />
        );
      })}
      {buckets.map((bucket, i) => {
        const active = isActive(bucket);
        const over = isOver(bucket, i);
        return (
          <circle
            key={bucket.key}
            cx={x(i)}
            cy={y(bucket.total)}
            r={active ? 1.3 : 0.9}
            data-testid={`chart-point-${bucket.key}`}
            onClick={() => onSelect?.(bucket.key)}
            className={`${over ? "fill-red-400" : "fill-emerald-400"} ${onSelect ? "cursor-pointer" : ""}`}
          >
            <title>{`${bucket.key} • ${formatIDRAbbreviated(bucket.total)}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
