import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

import { formatIDR } from "@expense-app/shared";
import type { WinStreakResult } from "@expense-app/shared";

import { WinStreakDialog } from "./WinStreakDialog";

export interface WinStreakCardProps {
  /** Today's civil day key (YYYY-MM-DD). */
  todayKey: string;
  /** Win streak data from computeWinStreaks. */
  winStreaks: WinStreakResult;
  /** Label for the "Lihat detail" link. */
  detailLabel?: string;
}

/**
 * Small Win streak section on the BudgetScreen, placed between BudgetToday
 * and BudgetPeriod (plan §5). Shows the current streak count + saving with
 * a "Lihat detail" link that opens the same WinStreakDialog as the home chip.
 */
function WinStreakCardInner({ todayKey, winStreaks, detailLabel }: WinStreakCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  return (
    <>
      <div
        data-testid="winstreak-card"
        className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-lg">🔥</span>
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Win streak
            </span>
          </div>
          <button
            type="button"
            data-testid="winstreak-card-open"
            onClick={() => setDialogOpen(true)}
            className="text-xs font-semibold text-neutral-300 hover:text-neutral-100"
          >
            {detailLabel ?? "Lihat detail"}
          </button>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span
              data-testid="winstreak-card-current"
              className="text-lg font-bold tabular-nums text-neutral-100"
            >
              {winStreaks.current ? `${winStreaks.current.count} hari` : "Hari ini melewati batas"}
            </span>
            {winStreaks.current?.endDate === todayKey && (
              <span
                data-testid="winstreak-card-live-badge"
                className="inline-block rounded border border-emerald-800 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
              >
                Hari ini berjalan
              </span>
            )}
          </div>
          <span
            data-testid="winstreak-card-saving"
            className="text-sm font-semibold tabular-nums text-emerald-300"
          >
            {winStreaks.current ? `Hemat ${formatIDR(winStreaks.current.saving)}` : ""}
          </span>
        </div>
      </div>

      {dialogOpen &&
        createPortal(
          <WinStreakDialog
            winStreaks={winStreaks}
            todayKey={todayKey}
            onClose={() => setDialogOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * WinStreakCard wrapper — only renders when winStreaks is non-null
 * (i.e. daily active budget with at least one run, or today over with history).
 */
export function WinStreakCard({ todayKey, winStreaks, detailLabel }: WinStreakCardProps) {
  if (!winStreaks) return null;
  return <WinStreakCardInner todayKey={todayKey} winStreaks={winStreaks} detailLabel={detailLabel} />;
}
