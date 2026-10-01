import { addCivilDays, formatDateShort, getZonedParts, zonedWallTimeToUtc } from "./periods";
import type { PeriodRange } from "./periods";

export type AllocationType = "NONE" | "WEEKLY" | "MONTHLY";

const ALLOCATION_DAYS: Record<"WEEKLY" | "MONTHLY", number> = {
  WEEKLY: 7,
  MONTHLY: 30,
};

export interface AllocationWindow {
  from: Date;
  to: Date;
  days: number;
}

export interface EffectiveAllocation {
  perDay: Map<string, bigint>;
  total: bigint;
}

/**
 * Compute the allocation window for an expense anchored at its occurredAt,
 * starting at 00:00 civil time in `timeZone` for `days` civil days.
 * (spec §Adv-1: Anchor 00:00 civil Jakarta)
 */
export function allocationWindow(
  occurredAt: Date,
  type: AllocationType,
  timeZone: string,
): AllocationWindow | null {
  if (type === "NONE") return null;
  const civil = getZonedParts(occurredAt, timeZone);
  const days = ALLOCATION_DAYS[type as "WEEKLY" | "MONTHLY"];
  const from = zonedWallTimeToUtc(timeZone, {
    year: civil.year,
    month: civil.month,
    day: civil.day,
  });
  const endCivil = addCivilDays(
    { year: civil.year, month: civil.month, day: civil.day },
    days,
  );
  const to = zonedWallTimeToUtc(timeZone, endCivil);
  return { from, to, days };
}

function civilKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Distribute `amount` across `days` civil days starting at `window.from`
 * in `timeZone`. Each day gets floor(amount/days); the remainder (1 per day)
 * is applied to the earliest days. Uses BigInt to avoid float drift.
 * (spec §Adv-2: remainder sebar 1 per hari awal)
 */
export function distributeAllocation(
  amount: number,
  window: AllocationWindow,
  timeZone: string,
): EffectiveAllocation {
  const perDay = new Map<string, bigint>();
  const bigAmount = BigInt(amount);
  const bigDays = BigInt(window.days);

  if (bigDays <= 0n || bigAmount <= 0n) {
    // Still populate keys so per-day lookups return 0n (caller may iterate).
    const startParts = getZonedParts(window.from, timeZone);
    let cursor = { year: startParts.year, month: startParts.month, day: startParts.day };
    for (let i = 0; i < window.days; i += 1) {
      perDay.set(civilKey(cursor.year, cursor.month, cursor.day), 0n);
      cursor = addCivilDays(cursor, 1);
    }
    return { perDay, total: 0n };
  }

  const base = bigAmount / bigDays;
  const remainder = bigAmount % bigDays;

  const startParts = getZonedParts(window.from, timeZone);
  let cursor = { year: startParts.year, month: startParts.month, day: startParts.day };

  for (let i = 0; i < window.days; i += 1) {
    perDay.set(civilKey(cursor.year, cursor.month, cursor.day), base);
    cursor = addCivilDays(cursor, 1);
  }

  // Spread remainder 1 per day on the earliest days.
  let cursor2 = { year: startParts.year, month: startParts.month, day: startParts.day };
  for (let i = 0; i < Number(remainder); i += 1) {
    const key = civilKey(cursor2.year, cursor2.month, cursor2.day);
    perDay.set(key, (perDay.get(key) ?? 0n) + 1n);
    cursor2 = addCivilDays(cursor2, 1);
  }

  let total = 0n;
  for (const value of perDay.values()) {
    total += value;
  }

  return { perDay, total };
}

/**
 * Compute the overlap between a period [period.from, period.to) and an
 * allocation window [window.from, window.to), measured in civil days in
 * `timeZone`.
 * (spec §Adv-3)
 */
export function allocationOverlapDays(
  period: { from: Date; to: Date },
  window: AllocationWindow,
  timeZone: string,
): number {
  const pFrom = getZonedParts(period.from, timeZone);
  const pTo = getZonedParts(period.to, timeZone);
  const wFrom = getZonedParts(window.from, timeZone);
  const wTo = getZonedParts(window.to, timeZone);

  const pStartMs = Date.UTC(pFrom.year, pFrom.month - 1, pFrom.day);
  const pEndMs = Date.UTC(pTo.year, pTo.month - 1, pTo.day);
  const wStartMs = Date.UTC(wFrom.year, wFrom.month - 1, wFrom.day);
  const wEndMs = Date.UTC(wTo.year, wTo.month - 1, wTo.day);

  const overlapMs = Math.max(0, Math.min(pEndMs, wEndMs) - Math.max(pStartMs, wStartMs));
  return Math.round(overlapMs / 86_400_000);
}

/**
 * For a single expense with allocationType, compute its effective amount
 * attributed to a given period. A non-allocated expense (type NONE) returns
 * the full amount if its occurredAt falls within [period.from, period.to).
 * An allocated expense returns sum over its per-day allocation that fall
 * within the period's civil days.
 */
export function expenseEffectiveAmount(
  expense: { amount: number; occurredAt: Date | string; allocationType?: AllocationType },
  period: { from: Date; to: Date },
  timeZone: string,
): number {
  const occurred = new Date(expense.occurredAt);

  if (!expense.allocationType || expense.allocationType === "NONE") {
    const t = occurred.getTime();
    return t >= period.from.getTime() && t < period.to.getTime() ? expense.amount : 0;
  }

  const win = allocationWindow(occurred, expense.allocationType, timeZone);
  if (!win) return 0;

  const { perDay } = distributeAllocation(expense.amount, win, timeZone);
  const overlap = allocationOverlapDays(period, win, timeZone);
  if (overlap <= 0) return 0;

  let result = 0n;
  const startParts = getZonedParts(new Date(Math.max(period.from.getTime(), win.from.getTime())), timeZone);
  const endParts = getZonedParts(new Date(Math.min(period.to.getTime(), win.to.getTime())), timeZone);

  let cursor = { year: startParts.year, month: startParts.month, day: startParts.day };
  const endKey = civilKey(endParts.year, endParts.month, endParts.day);

  for (let guard = 0; guard <= 31; guard += 1) {
    const key = civilKey(cursor.year, cursor.month, cursor.day);
    if (key >= endKey) break;
    result += perDay.get(key) ?? 0n;
    cursor = addCivilDays(cursor, 1);
  }

  return Number(result);
}

/**
 * Top-level convenience: allocate a single expense amount for a period.
 * Accepts a PeriodRange (web chart uses this shape).
 */
export function allocateAmount(
  amount: number,
  allocationType: AllocationType,
  occurredAt: string,
  period: PeriodRange,
  timeZone: string,
): number {
  return expenseEffectiveAmount({ amount, occurredAt, allocationType }, period, timeZone);
}

/**
 * Effective per-day allocation for a single allocated expense, keyed by
 * civil date string (YYYY-MM-DD) in `timeZone`. Non-allocated expenses
 * return a single-day map at their occurredAt civil day.
 */
export function effectiveAllocationForDay(
  amount: number,
  allocationType: AllocationType,
  occurredAt: string,
  timeZone: string,
): Map<string, number> {
  const occurred = new Date(occurredAt);
  const result = new Map<string, number>();

  if (!allocationType || allocationType === "NONE") {
    const parts = getZonedParts(occurred, timeZone);
    result.set(civilKey(parts.year, parts.month, parts.day), amount);
    return result;
  }

  const win = allocationWindow(occurred, allocationType, timeZone);
  if (!win) return result;

  const { perDay } = distributeAllocation(amount, win, timeZone);
  for (const [key, value] of perDay.entries()) {
    result.set(key, Number(value));
  }
  return result;
}

/**
 * Compute the allocation-aware total over a list of expenses for a period.
 * Each expense contributes either its full amount (if non-allocated and in-period)
 * or its prorated per-day allocation overlapping the period (if allocated).
 */
export function allocationAwareTotal(
  expenses: Array<{ amount: number; occurredAt: Date | string; allocationType?: AllocationType }>,
  period: { from: Date; to: Date },
  timeZone: string,
): number {
  return expenses.reduce((sum, expense) => {
    return sum + expenseEffectiveAmount(expense, period, timeZone);
  }, 0);
}

/**
 * Compute the civil day span of an allocation window and format the
 * end-caption + remaining-days text for a row.
 *
 * `viewedDayKey` is the civil day key (YYYY-MM-DD) the user is looking at,
 * in `timeZone`. The "last day" of a window is its civil `from` day + (days − 1).
 * Remaining is the civil-day difference between the window's last day and the
 * viewed day — never negative, so an already-expired window yields "hari terakhir"
 * rather than "sisa 0 hari".
 *
 * Returns null when there is no allocation window (NONE) so callers can skip
 * the sub-caption. For an invalid `viewedDayKey` the remaining text is omitted
 * (only "s.d. <end>" is returned) so the UI degrades gracefully.
 */
export function allocationEndCaption(
  occurredAt: string,
  allocationType: "WEEKLY" | "MONTHLY",
  timeZone: string,
  viewedDayKey: string,
): { endLabel: string; remainingText: string | null } | null {
  const expense = new Date(occurredAt);
  const win = allocationWindow(expense, allocationType, timeZone);
  if (!win) return null;

  const fromParts = getZonedParts(win.from, timeZone);
  const lastCivil = addCivilDays(
    { year: fromParts.year, month: fromParts.month, day: fromParts.day },
    win.days - 1,
  );
  const endLabel = formatDateShort(
    zonedWallTimeToUtc(timeZone, {
      year: lastCivil.year,
      month: lastCivil.month,
      day: lastCivil.day,
    }),
    timeZone,
  ).replace(/\s*\d{4}$/, "");

  const viewed = parseDayKey(viewedDayKey);
  if (viewed === null) return { endLabel, remainingText: null };

  const viewedMs = Date.UTC(viewed.year, viewed.month - 1, viewed.day);
  const lastMs = Date.UTC(lastCivil.year, lastCivil.month - 1, lastCivil.day);
  const diffDays = Math.round((lastMs - viewedMs) / 86_400_000);
  const clamped = Math.max(0, diffDays);

  const remainingText =
    clamped === 0 ? "hari terakhir" : `sisa ${clamped} hari`;
  return { endLabel, remainingText };
}

function parseDayKey(dayKey: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const parts = dayKey.split("-").map(Number);
  const [year, month, day] = parts as [number, number, number];
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return { year, month, day };
}

/**
 * Build the effective (fair) period range: the requested period capped at
 * "tomorrow 00:00 civil" in `timeZone`. This ensures future-tail days from a
 * rolling W/M window do not leak into today's fair total (spec §Adv-5: potong
 * hari ini). `now` is injectable for deterministic tests.
 */
export function fairPeriodRange(
  period: { from: Date; to: Date },
  timeZone: string,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const parts = getZonedParts(now, timeZone);
  const tomorrow = addCivilDays(
    { year: parts.year, month: parts.month, day: parts.day },
    1,
  );
  const tomorrowMidnight = zonedWallTimeToUtc(timeZone, tomorrow);
  return {
    from: period.from,
    to: new Date(Math.min(period.to.getTime(), tomorrowMidnight.getTime())),
  };
}

/**
 * Convenience: compute the fair total for a period over a list of expenses.
 * The candidate `expenses` should be fetched from an expanded range (at least
 * 30 days before `period.from`) so allocated expenses whose windows overlap
 * the period are included. (spec §Adv-5)
 *
 * Uses fairPeriodRange internally so the future tail is capped at tomorrow
 * 00:00 civil in `timeZone`.
 */
export function fairTotalForPeriod(
  expenses: Array<{ amount: number; occurredAt: Date | string; allocationType?: AllocationType }>,
  period: { from: Date; to: Date },
  timeZone: string,
  now: Date = new Date(),
): number {
  const range = fairPeriodRange(period, timeZone, now);
  return allocationAwareTotal(expenses, range, timeZone);
}

export interface FairBreakdownRow {
  id: string;
  occurredAt: string;
  allocationType: "WEEKLY" | "MONTHLY";
  perDayAmount: number;
}

export interface FairBreakdown {
  fairTotal: number;
  rows: FairBreakdownRow[];
}

/**
 * Breakdown of the fair total for a single civil day (`dayRange`, 1 calendar day
 * in `timeZone`), consistent with fairTotalForPeriod (caps `to` at tomorrow 00:00
 * civil via fairPeriodRange so the future tail does not leak).
 *
 * `expenses` must come from an expanded fetch (≥30 days before `dayRange.from`)
 * so allocated expenses whose windows overlap the focused day are included.
 *
 * Returns the fair total + the list of *contributing* allocation rows — one row
 * per allocated expense with a non-zero per-day contribution. Expense id is an
 * optional caller-supplied key (falls back to index) so optimistic rows without a
 * stable id can still be addressed by the UI.
 *
 * NONE expenses are excluded from `rows` (they only affect `fairTotal`); per spec
 * the breakdown lists only allocation contributors. When fair == raw (no
 * contributors) rows is empty and the caller shows its empty-state message.
 * (spec §Adv-5 breakdown)
 */
export function fairBreakdownForDay(
  expenses: Array<{
    amount: number;
    occurredAt: Date | string;
    allocationType?: AllocationType;
    id?: string;
  }>,
  dayRange: { from: Date; to: Date },
  timeZone: string,
  now: Date = new Date(),
): FairBreakdown {
  const range = fairPeriodRange(dayRange, timeZone, now);
  const dayKey = civilKey(
    getZonedParts(range.from, timeZone).year,
    getZonedParts(range.from, timeZone).month,
    getZonedParts(range.from, timeZone).day,
  );

  let fairTotal = 0;
  const rows: FairBreakdownRow[] = [];

  for (let i = 0; i < expenses.length; i += 1) {
    const expense = expenses[i]!;
    const type = expense.allocationType ?? "NONE";
    if (type === "NONE") {
      fairTotal += expenseEffectiveAmount(expense, range, timeZone);
      continue;
    }

     const perDayMap = effectiveAllocationForDay(expense.amount, type, new Date(expense.occurredAt).toISOString(), timeZone);
    const perDayAmount = perDayMap.get(dayKey) ?? 0;
    if (perDayAmount > 0) {
      fairTotal += perDayAmount;
      rows.push({
        id: expense.id ?? `fair-row-${i}`,
        occurredAt: new Date(expense.occurredAt).toISOString(),
        allocationType: type,
        perDayAmount,
      });
    }
  }

  return { fairTotal, rows };
}