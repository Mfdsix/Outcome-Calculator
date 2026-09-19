import type { ReactNode } from "react";

export interface HeaderProps {
  periodLabel: string;
  totalLabel: string;
  trailing?: ReactNode;
  /** Optional leading status (e.g. ConnIndicator) rendered left, next to the period label. */
  status?: ReactNode;
}

/** Slim top bar: period label (+ optional status) left, total + trailing cluster right. */
export function Header({ periodLabel, totalLabel, trailing, status }: HeaderProps) {
  return (
    <header className="flex items-baseline justify-between px-1 pb-2 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium text-neutral-400">{periodLabel}</span>
        {status}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-neutral-100" data-testid="header-total">
          {totalLabel}
        </span>
        {trailing}
      </div>
    </header>
  );
}
