import { useState } from "react";

import type { WinStreakResult } from "@expense-app/shared";

import { ShimmerText } from "./Shimmer";
import { WinStreakDialog } from "./WinStreakDialog";

export interface WinStreakChipProps {
  /** Today's civil day key (YYYY-MM-DD) — used to identify "live" run. */
  todayKey: string;
  /** Whether the series is still loading (shows shimmer). */
  seriesLoading: boolean;
  /** Win streak data; null when hidden (no budget / non-daily / finished). */
  winStreaks: WinStreakResult | null;
}

/**
 * Small 🔥 xN chip below InsightTicker on the calculator home screen.
 * Shows the current win streak count. Clickable → opens WinStreakDialog.
 * Shows a shimmer while series is loading. Hidden when winStreaks is null.
 * Pattern follows FairInfoButton for portal + dialog lifecycle.
 */
export function WinStreakChip({ todayKey, seriesLoading, winStreaks }: WinStreakChipProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (winStreaks === null) return null;

  const hasCurrent = winStreaks.current !== null;

  return (
    <>
      <button
        type="button"
        data-testid="winstreak-chip"
        aria-label="Winstreak — ketuk untuk lihat detail"
        title="Winstreak"
        onClick={() => setDialogOpen(true)}
        className={
          hasCurrent
            ? "mb-1 flex items-center gap-1 rounded-lg border border-emerald-800 bg-emerald-950/30 px-2 py-0.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/50"
            : "mb-1 flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-800/30 px-2 py-0.5 text-xs font-semibold text-neutral-500 hover:bg-neutral-800/50"
        }
      >
        {hasCurrent && <span aria-hidden="true">🔥</span>}
        {seriesLoading ? (
          <ShimmerText testid="winstreak-chip-shimmer" label="Memuat" className="h-4 w-12" />
        ) : (
          <span data-testid="winstreak-count">
            {hasCurrent ? winStreaks.current!.count : "streak putus"}
          </span>
        )}
      </button>

      {dialogOpen && (
        <WinStreakDialog
          winStreaks={winStreaks}
          todayKey={todayKey}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
