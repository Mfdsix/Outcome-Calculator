import { APP_TIMEZONE } from "./periods";

function isoDateOnly(d: Date, tz = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function relativeDayLabel(
  dayKey: string,
  now = new Date(),
  tz = APP_TIMEZONE
): string {
  if (!dayKey) return "";
  const today = isoDateOnly(now, tz);
  if (dayKey === today) return "Today";

  const yesterday = isoDateOnly(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
    tz
  );
  if (dayKey === yesterday) return "Yesterday";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tz,
  }).format(new Date(`${dayKey}T12:00:00+07:00`));
}
