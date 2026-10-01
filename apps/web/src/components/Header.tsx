import { type ReactNode } from "react";
import type { FairBreakdown } from "@expense-app/shared";

import { FairInfoButton } from "./FairBreakdown";
import { ShimmerText } from "./Shimmer";

export interface HeaderProps {
  periodLabel: string;
  totalLabel: string;
  trailing?: ReactNode;
  /** Optional leading status (e.g. ConnIndicator) rendered left, next to the period label. */
  status?: ReactNode;
  /** When true the total itself is a button toggling raw↔fair (dotted underline). */
  totalClickable?: boolean;
  /** True when the fair value is currently shown. */
  totalFairActive?: boolean;
  totalLoading?: boolean;
  onTotalClick?: () => void;
  /** Breakdown for the fair total (day scope only). When present and
   * totalFairActive, the value is rendered as a plain button (no dotted
   * underline) with a [?] info button beside it. Clicking the value still
   * toggles back to raw (toggle preserved). W/M overview never passes a
   * breakdown, so no [?] appears there. */
  fairBreakdown?: FairBreakdown | null;
  /** Title label for the [?] dialog title (e.g. "Rincian fair — 24 Sep"). */
  fairInfoLabel?: string;
  /** Civil day key (YYYY-MM-DD) the user is viewing, passed to the [?]
   * dialog so each row can show its allocation window end + remaining days. */
  fairInfoDayKey?: string | null;
}

/** Slim top bar: period label (+ optional status) left, total + trailing cluster right. */
export function Header({
  periodLabel,
  totalLabel,
  trailing,
  status,
  totalClickable = false,
  totalFairActive = false,
  totalLoading = false,
  onTotalClick,
  fairBreakdown,
  fairInfoLabel,
  fairInfoDayKey,
}: HeaderProps) {
  const totalAriaLabel = totalFairActive ? "Kembali ke total normal" : "Tampilkan total fair";
  const hasBreakdown = Boolean(fairBreakdown);
  // Fair mode active with a breakdown: the value stays a toggle button but
  // loses the dotted underline and gains a [?] info button.
  const totalIsFairPlain = totalFairActive && hasBreakdown;
  const valueIsButton = totalIsFairPlain || totalClickable;

  // While the fair value is loading, render a fixed-width shimmer so the
  // header doesn't flash "·raw" then the fair total. Fixed width avoids CLS.
  // fairBreakdown is null during loading (the hook resets it), so no [?] renders.
  if (totalLoading) {
    return (
      <header className="flex items-baseline justify-between px-1 pb-2 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium text-neutral-400" data-testid="header-period-label">{periodLabel}</span>
          {status}
        </div>
        <div className="flex items-center gap-2">
          <ShimmerText
            testid="header-total"
            label="Memuat total"
            className="h-5 w-20"
          />
          {trailing}
        </div>
      </header>
    );
  }

  return (
    <header className="flex items-baseline justify-between px-1 pb-2 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium text-neutral-400" data-testid="header-period-label">{periodLabel}</span>
        {status}
      </div>
      <div className="flex items-center gap-2">
        {valueIsButton ? (
          <button
            type="button"
            data-testid="header-total"
            aria-pressed={totalFairActive}
            aria-label={totalAriaLabel}
            title={totalAriaLabel}
            onClick={onTotalClick}
            className={`cursor-pointer text-sm font-semibold tabular-nums text-neutral-100 ${totalIsFairPlain ? "" : "fair-dotted"}`}
          >
            {totalLabel}
          </button>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-neutral-100" data-testid="header-total">
            {totalLabel}
          </span>
        )}
        {totalIsFairPlain && (
          <FairInfoButton
            label={fairInfoLabel ?? "Rincian fair — Hari ini"}
            breakdown={fairBreakdown!}
            show={true}
            dayKey={fairInfoDayKey ?? null}
          />
        )}
        {trailing}
      </div>
    </header>
  );
}
