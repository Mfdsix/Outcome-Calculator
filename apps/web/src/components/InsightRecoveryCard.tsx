import { useMemo, useState } from "react";

import type { RecoveryPlan } from "@expense-app/shared";
import { formatDateShort, formatIDR, recoveryOption } from "@expense-app/shared";

import { APP_TIMEZONE } from "../lib/periods";

export interface InsightRecoveryCardProps {
  plan: RecoveryPlan;
}

function formatDate(civil: string): string {
  return formatDateShort(new Date(`${civil}T12:00:00+07:00`), APP_TIMEZONE);
}

/**
 * "Anjuran hemat" — the daily counterpart of `full-recover`. Appears only when
 * the budget is in the red CUMULATIVELY (`spent` vs `cap × elapsed days`): drag
 * the horizon slider (1 day … the budget's last day) and see the per-day
 * saving + daily target that brings the position back to break-even (+0).
 *
 * Daily caps reset every day, so nothing is "absorbed" automatically — the
 * planner is what turns the running overrun into an actionable number.
 */
export function InsightRecoveryCard({ plan }: InsightRecoveryCardProps) {
  /** Default = the whole remaining period (the most forgiving plan). */
  const [days, setDays] = useState<number | null>(null);
  const maxDays = Math.max(1, plan.daysLeft);
  const selectedDays = Math.min(maxDays, Math.max(1, days ?? maxDays));

  const option = useMemo(
    () =>
      recoveryOption({
        todayKey: plan.todayKey,
        days: selectedDays,
        deficit: plan.deficit,
        dailyCap: plan.dailyCap,
      }),
    [plan.todayKey, selectedDays, plan.deficit, plan.dailyCap],
  );

  if (!plan.available) return null;

  return (
    <section
      data-testid="insight-recovery"
      aria-labelledby="insight-recovery-heading"
      className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="insight-recovery-heading"
          className="text-[10px] uppercase tracking-widest text-neutral-500"
        >
          Anjuran hemat
        </h2>
        {plan.daysLeft > 0 && (
          <span
            data-testid="insight-recovery-days"
            className="text-xs font-semibold tabular-nums text-neutral-300"
          >
            {selectedDays} hari
          </span>
        )}
      </div>

      <p data-testid="insight-recovery-deficit" className="mt-0.5 text-sm leading-snug text-neutral-200">
        Total <span className="font-semibold tabular-nums text-red-300">lewat {formatIDR(plan.deficit)}</span>{" "}
        dari jatah periode {formatIDR(plan.allowanceToDate)}.
      </p>
      <p data-testid="insight-recovery-progress" className="mt-0.5 text-[11px] text-neutral-500">
        {formatIDR(plan.spentToDate)} kepake · {plan.elapsedDays} hari berjalan
      </p>

      {plan.daysLeft === 0 ? (
        <p data-testid="insight-recovery-lastday" className="mt-2 text-xs text-neutral-400">
          Hari terakhir periode — nggak bisa dikejar. Besok reset.
        </p>
      ) : (
        <>
          <input
            type="range"
            data-testid="insight-recovery-slider"
            min={1}
            max={maxDays}
            step={1}
            value={selectedDays}
            aria-label="Lama waktu berhemat (hari)"
            aria-valuetext={`${selectedDays} hari, hemat ${formatIDR(option.savingsPerDay)} per hari`}
            onChange={(event) => setDays(Number(event.target.value))}
            className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-emerald-500"
          />
          <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>1 hari</span>
            <span data-testid="insight-recovery-max">sampai {formatDate(plan.endDate)}</span>
          </div>

          {option.reachable ? (
            <div className="mt-2 border-t border-neutral-800/80 pt-2">
              <p className="text-sm leading-snug text-neutral-200">
                Hemat{" "}
                <span
                  data-testid="insight-recovery-savings"
                  className="font-semibold tabular-nums text-amber-300"
                >
                  {formatIDR(option.savingsPerDay)}/hari
                </span>{" "}
                → jaga di{" "}
                <span
                  data-testid="insight-recovery-target"
                  className="font-semibold tabular-nums text-emerald-300"
                >
                  {formatIDR(option.targetPerDay)}/hari
                </span>
              </p>
              <p data-testid="insight-recovery-end" className="mt-0.5 text-xs text-neutral-500">
                Balik impas {formatDate(option.endDate)} · {option.days} hari.
              </p>
            </div>
          ) : (
            <p
              data-testid="insight-recovery-unreachable"
              className="mt-2 text-xs leading-snug text-red-300"
            >
              Nggak muat {option.days} hari — minimal butuh{" "}
              <span className="font-semibold tabular-nums">{plan.minDaysToBreakEven} hari</span>{" "}
              tanpa pengeluaran buat balik impas.
            </p>
          )}
        </>
      )}
    </section>
  );
}
