import { describe, expect, it } from "vitest";
import { relativeDayLabel } from "./dayLabels";

const T = (iso: string) => new Date(iso);

describe("relativeDayLabel", () => {
  it("returns Today for today key", () => {
    const now = T("2026-09-19T14:30:00+07:00");
    expect(relativeDayLabel("2026-09-19", now)).toBe("Today");
  });

  it("returns Yesterday for yesterday civil day", () => {
    const now = T("2026-09-19T14:30:00+07:00");
    expect(relativeDayLabel("2026-09-18", now)).toBe("Yesterday");
  });

  it("returns weekday English long for older keys", () => {
    const now = T("2026-09-19T14:30:00+07:00");
    expect(relativeDayLabel("2026-09-14", now)).toBe("Monday");
    expect(relativeDayLabel("2026-09-13", now)).toBe("Sunday");
  });

  it("handles month boundary (Sep 1 vs Aug 31)", () => {
    const now = T("2026-09-01T10:00:00+07:00");
    expect(relativeDayLabel("2026-08-31", now)).toBe("Yesterday");
    expect(relativeDayLabel("2026-08-30", now)).toBe("Sunday");
  });

  it("Today at midnight still Today", () => {
    const now = T("2026-09-19T00:00:00+07:00");
    expect(relativeDayLabel("2026-09-19", now)).toBe("Today");
  });

  it("falls back to key-derived weekday for malformed", () => {
    const now = T("2026-09-19T14:30:00+07:00");
    expect(relativeDayLabel("2026-09-20", now)).toBe("Sunday");
  });

  it("returns empty string for empty key", () => {
    expect(relativeDayLabel("", T("2026-09-19T14:30:00+07:00"))).toBe("");
  });
});
