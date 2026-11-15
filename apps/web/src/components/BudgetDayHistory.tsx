import { useMemo, useState } from "react";

import type { BudgetSeriesDay } from "@expense-app/shared";
import { formatDateShort, formatIDR } from "@expense-app/shared";

import { APP_TIMEZONE } from "../lib/periods";
import { relativeDayLabel } from "../lib/dayLabels";

/** Layer 3 — Day History (plan §3): 14 default rows + expand button. */
export const HISTORY_DEFAULT = 14;

export interface BudgetDayHistoryProps {
  /** Zero-filled day series (`delta` present for daily budgets). */
  days: BudgetSeriesDay[];
  maxInitial?: number;
}

/**
 * Newest-first day list with the daily `+`/`−` delta. Shared by the active
 * budget (clamped to today) and a focused past budget (full range).
 */
export function BudgetDayHistory({ days, maxInitial = HISTORY_DEFAULT }: BudgetDayHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  // Newest first (today on top); the 14-row default keeps the latest days.
  const ordered = useMemo(() => [...days].reverse(), [days]);
  const visible = expanded ? ordered : ordered.slice(0, maxInitial);
  const hasMore = days.length > maxInitial;

  return (
    <section data-testid="budget-day-history">
      <h2 className="mb-1 px-1 text-[11px] uppercase tracking-widest text-neutral-500">
        Riwayat harian
      </h2>
      <ul className="divide-y divide-neutral-800/80 border border-neutral-800">
        {visible.map((day) => {
          const delta = "delta" in day ? day.delta : null;
          return (
            <li
              key={day.date}
              data-testid={`budget-day-row-${day.date}`}
              className="flex items-start justify-between gap-2 py-3 px-1 hover:bg-white/5">
              <div className="flex flex-col">
                <span
                  className="text-sm font-medium text-neutral-200"
                  data-testid={`budget-day-label-${day.date}`}>
                  {relativeDayLabel(day.date, new Date())}
                </span>
                <span className="text-xs text-neutral-500">
                  {formatDateShort(new Date(`${day.date}T12:00:00+07:00`), APP_TIMEZONE)}
                </span>
              </div>
              {delta !== null && (
                <span
                  className={`text-sm font-medium tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  data-testid={`budget-day-delta-${day.date}`}>
                  {delta >= 0 ? `+${formatIDR(delta)}` : `−${formatIDR(-delta)}`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && !expanded && (
        <button
          type="button"
          data-testid="budget-history-more"
          onClick={() => setExpanded(true)}
          className="mt-1 w-full text-center text-xs font-semibold text-neutral-300 active:text-neutral-100">
          Tampilkan {days.length - maxInitial} hari lainnya
        </button>
      )}
    </section>
  );
}
