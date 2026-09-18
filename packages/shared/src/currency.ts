import { getZonedParts, pad2 } from "./periods";

/** Strip non-digits and leading zeros; '' → '0'. */
export function normalizeDigits(input: string): string {
  const digits = input.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits;
}

/** Group digit strings with dot separators: '35000' → '35.000'. Empty → '0'. */
export function groupDigits(input: string): string {
  const digits = normalizeDigits(input);
  if (!digits) return "0";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Parse a digit string into an integer amount. Unsafe integers collapse to 0. */
export function digitsToAmount(input: string): number {
  const digits = normalizeDigits(input);
  if (!digits) return 0;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : 0;
}

/** Full IDR display: formatIDR(35000) → 'Rp35.000'. */
export function formatIDR(amount: number): string {
  if (!Number.isFinite(amount)) return "Rp0";
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rp${groupDigits(String(Math.abs(Math.trunc(amount))))}`;
}

function compactNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  let text = String(rounded);
  if (text.includes(".")) text = text.replace(/\.0$/, "");
  return text.replace(".", ",");
}

/** Abbreviated display for large header totals: 'Rp1,2 jt' / 'Rp1,3 M'. */
export function formatIDRAbbreviated(amount: number): string {
  if (!Number.isFinite(amount)) return "Rp0";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp${compactNumber(amount / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `Rp${compactNumber(amount / 1_000_000)} jt`;
  return formatIDR(amount);
}
