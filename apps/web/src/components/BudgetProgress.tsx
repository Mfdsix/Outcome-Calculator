import type { BudgetStatus } from "@expense-app/shared";

import { formatIDRAbbreviated, formatIDR } from "../lib/currency";

export interface BudgetProgressProps {
  variant: "card" | "micro";
  type: "full" | "daily";
  amount: number;
  spent: number;
  remaining: number;
  status: BudgetStatus;
  progressPct: number;
  /** Card only: "1–30 Sep • Harian" period label. */
  periodLabel?: string;
  /** Card only: the budget period is fully past → gray "Selesai" card. */
  finished?: boolean;
}

const STATUS_LABEL: Record<BudgetStatus, string> = {
  ok: "Aman",
  warning: "Hampir habis",
  over: "Lewat batas",
};

const STATUS_CLASS: Record<BudgetStatus, string> = {
  ok: "text-emerald-300",
  warning: "text-amber-300",
  over: "text-red-300",
};

const BAR_CLASS: Record<BudgetStatus, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  over: "bg-red-500",
};

/** "1–30 Sep • Harian" rendered from civil dates (id-ID month). */
function periodLabelOf(startDate: string, endDate: string, type: "full" | "daily"): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const parse = (value: string): { day: number; month: number } => {
    const [, month, day] = value.split("-").map(Number) as [number, number, number];
    return { day, month };
  };
  const start = parse(startDate);
  const end = parse(endDate);
  const typeLabel = type === "daily" ? "Harian" : "Penuh";
  const sameMonth = start.month === end.month;
  const range = sameMonth
    ? `${start.day}–${end.day} ${MONTHS[start.month - 1] ?? ""}`
    : `${start.day} ${MONTHS[start.month - 1] ?? ""} – ${end.day} ${MONTHS[end.month - 1] ?? ""}`;
  return `${range} • ${typeLabel}`;
}

/**
 * Budget progress renderer (plan §3–§4):
 * - variant "card": the full active-budget card (headline, bar, %, period).
 * - variant "micro": one inline row under the header on the calculator
 *   screen — remaining today only, zero noise otherwise.
 */
export function BudgetProgress({
  variant,
  type,
  amount,
  spent,
  remaining,
  status,
  progressPct,
  periodLabel,
  finished = false,
}: BudgetProgressProps) {
  if (variant === "micro") {
    const over = status === "over";
    return (
      <div
        data-testid="budget-micro"
        className={`mb-1 flex items-baseline justify-between px-1 text-[11px] ${
          over ? "text-red-300" : "text-neutral-400"
        }`}
      >
        <span>
          {over ? "Lewat " : "Sisa hari ini: "}
          <span className={`font-semibold tabular-nums ${over ? "text-red-200" : "text-neutral-200"}`}>
            {over ? formatIDRAbbreviated(spent - amount) : formatIDR(remaining)}
          </span>
        </span>
        <span className="tabular-nums text-neutral-500">
          {formatIDRAbbreviated(spent)} / {formatIDRAbbreviated(amount)}
        </span>
      </div>
    );
  }

  const dailyHeadline = type === "daily";
  // Finished period (plan §3): gray card, neutral chip — no live status color.
  const effectiveStatus: BudgetStatus | "finished" = finished ? "finished" : status;
  return (
    <div
      data-testid="budget-card"
      className={`rounded-xl border px-4 py-3 ${
        finished
          ? "border-neutral-800 bg-neutral-900/40 opacity-60"
          : status === "over"
            ? "border-red-900/70 bg-red-950/30"
            : status === "warning"
              ? "border-amber-900/70 bg-amber-950/20"
              : "border-neutral-800 bg-neutral-900/60"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-widest text-neutral-500">
          {dailyHeadline ? "Sisa hari ini" : "Sisa"}
        </span>
        <span
          className={`text-xs font-semibold ${
            finished ? "text-neutral-400" : STATUS_CLASS[status]
          }`}
        >
          {finished ? "Selesai" : STATUS_LABEL[status]}
        </span>
      </div>
      <p className="mt-1 font-light tabular-nums text-neutral-50">
        <span className="text-2xl">{formatIDR(remaining)}</span>
        <span className="text-sm text-neutral-500"> dari {formatIDRAbbreviated(amount)}</span>
      </p>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, progressPct)}
        aria-label="Progres budget"
      >
        <div
          className={`h-full rounded-full ${finished ? "bg-neutral-600" : BAR_CLASS[status]} transition-[width] duration-500`}
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-neutral-500">
        <span>{periodLabel ?? ""}</span>
        <span className="tabular-nums">{progressPct}% terpakai</span>
      </div>
    </div>
  );
}

export { periodLabelOf };
