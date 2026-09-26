import type { AllocationType } from "@expense-app/shared";

export interface AdvancedControlsProps {
  /** Currently selected allocation type. */
  allocationType: AllocationType;
  /** Called when the user toggles a pill. Tap active → NONE. */
  onToggle: (type: AllocationType) => void;
}

/**
 * Advanced Controls bar shown in place of the BarChart when the calculator
 * is in edit mode on the home screen (spec §3: AdvancedControls swap).
 * Shows "ADVANCED CONTROLS / Mark as [Weekly] [Monthly]" pill toggles.
 * Tap an active pill → NONE.
 */
export function AdvancedControls({ allocationType, onToggle }: AdvancedControlsProps) {
  return (
    <div
      data-testid="advanced-controls"
      className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-3"
    >
      <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-500">
        ADVANCED CONTROLS
      </div>
      <div className="flex gap-2">
        {(["WEEKLY", "MONTHLY"] as const).map((type) => {
          const active = allocationType === type;
          return (
            <button
              key={type}
              type="button"
              data-testid={`allocation-${type.toLowerCase()}`}
              onClick={() => onToggle(active ? "NONE" : type)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
                active
                  ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
                  : "border-neutral-800 bg-neutral-900/60 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
              }`}
            >
              {type === "WEEKLY" ? "Weekly" : "Monthly"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
