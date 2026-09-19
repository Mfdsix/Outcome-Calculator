import type { Insight } from "@expense-app/shared";

const TONE_DOT: Record<Insight["tone"], string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  over: "bg-red-400",
  info: "bg-neutral-400",
};

export interface InsightScreenProps {
  insights: Insight[];
  /** True when no active budget — shows the "Atur budget" CTA. */
  hasBudget: boolean;
  onBack: () => void;
  onOpenBudget: () => void;
}

/**
 * Full insight list (plan "Insight Kecil" §3): every insight with its tone
 * dot + one casual sentence, nominals in full formatIDR. Layout mirrors
 * BudgetScreen (top bar + back). Without a budget the CTA jumps to the
 * budget screen so the user can set one up.
 */
export function InsightScreen({ insights, hasBudget, onBack, onOpenBudget }: InsightScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insight-screen">
      {/* Top bar — same pattern as BudgetScreen */}
      <div className="flex items-center gap-2 pb-2">
        <button
          type="button"
          aria-label="Kembali ke kalkulator"
          data-testid="insight-back"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-300 active:bg-neutral-800"
        >
          ←
        </button>
        <h1 className="text-base font-semibold text-neutral-100">Insight</h1>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        <ul
          data-testid="insight-list"
          className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800 bg-neutral-900/50"
        >
          {insights.map((insight) => (
            <li
              key={insight.id}
              data-testid={`insight-item-${insight.id}`}
              className="flex items-start gap-2.5 px-3 py-3"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[insight.tone]}`}
                aria-hidden="true"
              />
              <p className="text-sm leading-snug text-neutral-200">{insight.full}</p>
            </li>
          ))}
        </ul>

        {!hasBudget && (
          <button
            type="button"
            data-testid="insight-cta-budget"
            onClick={onOpenBudget}
            className="h-11 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white shadow-[0_2px_0_0_#065f46] active:shadow-none"
          >
            Atur budget
          </button>
        )}
      </div>
    </div>
  );
}
