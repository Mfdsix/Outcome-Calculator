import { budgetStatus, civilToday, formatCivilDate, inclusiveDayCount } from "./budget";
import type { BudgetStatus, BudgetType } from "./budget";
import { formatDateShort } from "./periods";
import { formatIDRAbbreviated, formatIDR } from "./currency";

/**
 * Insight engine (plan "Insight Kecil: Ticker + Menu ⓘ") — PURE, no fetch.
 * Everything is derived from data the calculator screen already has: the
 * active budget snapshot (server-computed spent) + today's total from the
 * live expense list (optimistic + offline-cache friendly).
 *
 * Pace semantics:
 * - daily: fair line = today's cap; status ladder reused from budgetStatus.
 * - full: fair line (jalur wajar) at end of day d = d/N × cap. Deviation
 *   beyond PACE_DEVIATION_PCT of the cap → "boros" (or "hemat" when under).
 *   Savings needed per day = deviation ÷ remaining days (ceil to Rp1.000).
 */

export type InsightTone = "ok" | "warn" | "over" | "info";

export interface Insight {
  /** Stable id (tests + ticker keys + list rows). */
  id: string;
  /** Ticker line — one short casual sentence (≤ ~60 chars). */
  short: string;
  /** List line — one casual sentence, nominals in full formatIDR. */
  full: string;
  tone: InsightTone;
}

/** Structural subset of BudgetActiveResponse["budget"] the engine needs. */
export interface InsightBudgetSnapshot {
  type: BudgetType;
  amount: number;
  /** Inclusive civil dates YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** Spent inside the budget range so far (server-computed). */
  spent: number;
  status: BudgetStatus;
}

export interface InsightInput {
  active: InsightBudgetSnapshot | null;
  /** Today's total in the app timezone (live list + optimistic + cache). */
  todayTotal: number;
  now: Date;
  timeZone: string;
}

/** Pace deviation threshold as a percent of the (full) budget cap. */
export const PACE_DEVIATION_PCT = 10;

/**
 * Compact ticker nominal: Rp25rb style under Rp1jt (formatIDRAbbreviated only
 * abbreviates ≥ 1jt, which keeps ticker lines long), "Rp1,2 jt" above, and
 * full formatIDR when rounding to rb would hide the value (Rp400, Rp0).
 */
function formatIDRCompact(amount: number): string {
  if (!Number.isFinite(amount) || Math.abs(amount) < 500) return formatIDR(amount);
  const rb = Math.round(amount / 1000);
  if (rb * 1000 >= 1_000_000) return formatIDRAbbreviated(amount);
  return `Rp${rb}rb`;
}

/** Noon-UTC anchor keeps the civil date stable for any real timezone. */
function civilDateToSafeDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function shortDate(value: string, timeZone: string): string {
  return formatDateShort(civilDateToSafeDate(value), timeZone);
}

function dailyInsights(budget: InsightBudgetSnapshot, todayTotal: number): Insight[] {
  const status = budgetStatus(todayTotal, budget.amount);
  const remaining = budget.amount - todayTotal;

  if (status === "over") {
    const over = todayTotal - budget.amount;
    return [
      {
        id: "daily-over",
        short: `Lewat ${formatIDRCompact(over)} hari ini. Besok reset.`,
        full: `Hari ini lewat ${formatIDR(over)} dari jatah ${formatIDR(budget.amount)}. Besok reset kok.`,
        tone: "over",
      },
    ];
  }
  if (status === "warning") {
    const left = Math.max(0, remaining);
    return [
      {
        id: "daily-warning",
        short: `Tinggal ${formatIDRCompact(left)}, rem dikit ya.`,
        full: `Jatah hari ini tinggal ${formatIDR(left)} dari ${formatIDR(budget.amount)} — rem dikit ya.`,
        tone: "warn",
      },
    ];
  }
  return [
    {
      id: "daily-ok",
      short: `Sisa ${formatIDRCompact(remaining)} hari ini, santai.`,
      full: `Hari ini masih ada ${formatIDR(remaining)} dari jatah ${formatIDR(budget.amount)} — santai.`,
      tone: "ok",
    },
  ];
}

function fullInsights(
  budget: InsightBudgetSnapshot,
  todayKey: string,
): Insight[] {
  const totalDays = inclusiveDayCount(budget.startDate, budget.endDate);
  // 1-based day index; todayKey is guaranteed within [startDate, endDate].
  const dayIndex = inclusiveDayCount(budget.startDate, todayKey);
  const path = Math.round((budget.amount * dayIndex) / totalDays);
  const dev = budget.spent - path;
  const threshold = Math.round((budget.amount * PACE_DEVIATION_PCT) / 100);
  const daysLeft = totalDays - dayIndex; // days AFTER today

  // Boros: pace clearly ahead of the fair line, OR the cap itself is gone
  // (status over — e.g. the last day where path ≈ cap hides the overrun).
  if (dev > threshold || budget.status === "over") {
    const insights: Insight[] = [
      {
        id: "full-boros",
        short: `Agak boros ya, −${formatIDRCompact(dev)} dari jalur.`,
        full: `Kepake ${formatIDR(budget.spent)}, jalur wajar ${formatIDR(path)} — agak boros ${formatIDR(dev)}.`,
        tone: budget.status === "over" ? "over" : "warn",
      },
    ];
    if (daysLeft > 0) {
      const perDay = Math.ceil(dev / daysLeft / 1000) * 1000;
      insights.push({
        id: "full-recover",
        short: `Hemat ${formatIDRCompact(perDay)}/hari, balik normal.`,
        full: `Sisihkan ${formatIDR(perDay)}/hari di ${daysLeft} hari sisa biar balik ke jalur.`,
        tone: "warn",
      });
    }
    return insights;
  }

  if (dev < -threshold) {
    return [
      {
        id: "full-hemat",
        short: `Hemat ${formatIDRCompact(-dev)} sejauh ini, mantap.`,
        full: `Di bawah jalur ${formatIDR(-dev)} — mantap, lanjutkan.`,
        tone: "ok",
      },
    ];
  }

  return [
    {
      id: "full-track",
      short: `Jalur aman, hari ke-${dayIndex} dari ${totalDays}.`,
      full: `Hari ke-${dayIndex} dari ${totalDays}, pengeluaran masih di jalur wajar.`,
      tone: "ok",
    },
  ];
}

/**
 * Build the insight list, ordered by priority (over > warning > pace-nudge >
 * ok > no-budget). Pure: same input → same output; `now` is injectable for
 * tests. Rules are mutually exclusive per category, so no duplicate content
 * ever coalesces; the full-boros case yields at most one follow-up nudge.
 */
export function buildInsights(input: InsightInput): Insight[] {
  const { active, timeZone } = input;

  if (active === null) {
    return [
      {
        id: "no-budget",
        short: "Pasang budget biar ada yang ngingetin.",
        full: "Belum ada budget — pasang batas harian atau bulanan biar ada yang ngingetin.",
        tone: "info",
      },
    ];
  }

  const todayKey = formatCivilDate(civilToday(timeZone, input.now));

  // Finished period (plan §5 edge case): pace insights off, one info instead.
  if (todayKey > active.endDate) {
    return [
      {
        id: "finished",
        short: "Budget selesai, bikin yang baru?",
        full: "Periode budget udah lewat — bikin yang baru yuk.",
        tone: "info",
      },
    ];
  }

  // Not started yet: no pace to judge.
  if (todayKey < active.startDate) {
    const starts = shortDate(active.startDate, timeZone);
    return [
      {
        id: "upcoming",
        short: `Budget mulai ${starts}, santai dulu.`,
        full: `Budget mulai berlaku ${starts} — santai dulu.`,
        tone: "info",
      },
    ];
  }

  return active.type === "daily"
    ? dailyInsights(active, input.todayTotal)
    : fullInsights(active, todayKey);
}
