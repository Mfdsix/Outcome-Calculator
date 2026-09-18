export interface AmountDisplayProps {
  display: string;
  editing: boolean;
  flash: boolean;
}

/** Calculator readout: the amount being entered, right-aligned like a real calculator. */
export function AmountDisplay({ display, editing, flash }: AmountDisplayProps) {
  return (
    <div className="flex min-h-20 flex-1 flex-col items-end justify-end pb-2" aria-live="polite">
      {editing && (
        <span className="mb-1 text-[11px] uppercase tracking-widest text-amber-400/90">
          Edit
        </span>
      )}
      <span
        data-testid="amount-display"
        className={`tabular-nums transition-colors duration-300 ${
          flash ? "text-emerald-400" : "text-neutral-50"
        } ${display.length > 10 ? "text-4xl" : "text-5xl"} font-light`}
      >
        {display}
      </span>
    </div>
  );
}
