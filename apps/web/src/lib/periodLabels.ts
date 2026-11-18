import { formatDateShort } from "@expense-app/shared";

import { APP_TIMEZONE } from "./periods";

/** Build a civil date label (e.g. "15 Sep") from a YYYY-MM-DD bucket key. */
export function dateLabelFromKey(key: string): string {
  const parts = key.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return key;
  const [year, month, day] = parts;
  const isoAtMidnight = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`;
  return formatDateShort(new Date(isoAtMidnight), APP_TIMEZONE);
}

/**
 * Pair-range label for month drill/titles (e.g. "20–21 Sep", or "30 Sep–1 Okt").
 * Without an endKey (orphan single) it degrades to the plain day label.
 */
export function pairMidLabel(startKey: string, endKey?: string): string {
  const startLabel = dateLabelFromKey(startKey);
  if (!endKey || endKey === startKey) return startLabel;
  const endLabel = dateLabelFromKey(endKey);
  const [startDay, startMon] = startLabel.split(" ");
  const [endDay, endMon] = endLabel.split(" ");
  if (!startDay || !startMon || !endDay || !endMon) return startLabel;
  return startMon === endMon ? `${startDay}–${endDay} ${startMon}` : `${startLabel}–${endLabel}`;
}
