import type { ReactNode } from "react";

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
}: HeaderProps) {
  const totalAriaLabel = totalFairActive ? "Kembali ke total normal" : "Tampilkan total fair";
  return (
    <header className="flex items-baseline justify-between px-1 pb-2 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium text-neutral-400" data-testid="header-period-label">{periodLabel}</span>
        {status}
      </div>
      <div className="flex items-center gap-2">
        {totalClickable ? (
          <button
            type="button"
            data-testid="header-total"
            aria-pressed={totalFairActive}
            aria-label={totalAriaLabel}
            title={totalAriaLabel}
            onClick={onTotalClick}
            className={`fair-dotted cursor-pointer text-sm font-semibold tabular-nums text-neutral-100 ${
              totalLoading ? "animate-pulse" : ""
            }`}
          >
            {totalLabel}
          </button>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-neutral-100" data-testid="header-total">
            {totalLabel}
          </span>
        )}
        {trailing}
      </div>
    </header>
  );
}
