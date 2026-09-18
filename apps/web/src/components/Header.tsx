import type { ReactNode } from "react";

export interface HeaderProps {
  periodLabel: string;
  totalLabel: string;
  trailing?: ReactNode;
}

/** Slim top bar: period label left, total + trailing cluster right (spec plan §4). */
export function Header({ periodLabel, totalLabel, trailing }: HeaderProps) {
  return (
    <header className="flex items-baseline justify-between px-1 pb-2 pt-4">
      <span className="text-sm font-medium text-neutral-400">{periodLabel}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-neutral-100" data-testid="header-total">
          {totalLabel}
        </span>
        {trailing}
      </div>
    </header>
  );
}
