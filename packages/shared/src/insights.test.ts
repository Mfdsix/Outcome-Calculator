import { describe, expect, it } from "vitest";

import { buildInsights, PACE_DEVIATION_PCT } from "./insights";
import type { InsightInput, InsightBudgetSnapshot } from "./insights";

const TZ = "Asia/Jakarta";

/** 2026-09-19 10:00 WIB. */
const NOW = new Date("2026-09-19T10:00:00+07:00");

function budget(overrides: Partial<InsightBudgetSnapshot> = {}): InsightBudgetSnapshot {
  return {
    type: "daily",
    amount: 100_000,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    spent: 65_000,
    status: "ok",
    ...overrides,
  };
}

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return { active: budget(), todayTotal: 65_000, now: NOW, timeZone: TZ, ...overrides };
}

describe("buildInsights — daily rules", () => {
  it("rule 1: daily, sisa > 0, status ok → sisa santai (plan §2 #1)", () => {
    const insights = buildInsights(input({ todayTotal: 75_000 }));
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe("daily-ok");
    expect(insights[0]!.short).toBe("Sisa Rp25rb hari ini, santai.");
    expect(insights[0]!.full).toContain("Rp25.000");
    expect(insights[0]!.tone).toBe("ok");
  });

  it("rule 2: daily warning (≥80% cap) → rem dikit", () => {
    const insights = buildInsights(input({ todayTotal: 95_000 }));
    expect(insights[0]!.id).toBe("daily-warning");
    expect(insights[0]!.short).toBe("Tinggal Rp5rb, rem dikit ya.");
    expect(insights[0]!.tone).toBe("warn");
  });

  it("rule 3: daily over → lewat + besok reset", () => {
    const insights = buildInsights(input({ todayTotal: 135_000 }));
    expect(insights[0]!.id).toBe("daily-over");
    expect(insights[0]!.short).toBe("Lewat Rp35rb hari ini. Besok reset.");
    expect(insights[0]!.tone).toBe("over");
  });

  it("daily status derives from todayTotal, not the stale server status", () => {
    // Server says ok (computed earlier) but today just crossed the cap.
    const insights = buildInsights(input({ todayTotal: 101_000, active: budget({ status: "ok" }) }));
    expect(insights[0]!.id).toBe("daily-over");
  });
});

describe("buildInsights — full (pace) rules", () => {
  // Full 1jt / 1–30 Sep; today = day 19 → jalur wajar = 19/30 × 1jt ≈ 633.333.
  const FULL = { type: "full" as const, amount: 1_000_000, startDate: "2026-09-01", endDate: "2026-09-30" };

  it("rule 4: full on-track (small deviation) → jalur aman + hari ke-N", () => {
    const insights = buildInsights(
      input({ active: budget({ ...FULL, spent: 620_000 }), todayTotal: 0 }),
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe("full-track");
    expect(insights[0]!.short).toBe("Jalur aman, hari ke-19 dari 30.");
    expect(insights[0]!.tone).toBe("ok");
  });

  it("rule 5: full boros beyond threshold → agak boros dari jalur", () => {
    // Threshold = 10% × 1jt = 100rb; dev = 800.000 − 633.333 ≈ 166.667 > 100rb.
    const insights = buildInsights(
      input({ active: budget({ ...FULL, spent: 800_000 }), todayTotal: 0 }),
    );
    expect(insights[0]!.id).toBe("full-boros");
    expect(insights[0]!.short).toMatch(/^Agak boros ya, −Rp1\d+rb dari jalur\.$/);
    expect(insights[0]!.tone).toBe("warn");
  });

  it("rule 5b: full over status forces boros even when pace hides it (last day)", () => {
    // Single-day range equal to today: path = cap = spent → dev = 0, but the
    // server status over (spent just past the cap) must still surface boros.
    const insights = buildInsights(
      input({
        active: budget({ ...FULL, startDate: "2026-09-19", endDate: "2026-09-19", spent: 1_100_000, status: "over" }),
        todayTotal: 0,
      }),
    );
    expect(insights[0]!.id).toBe("full-boros");
    expect(insights[0]!.tone).toBe("over");
  });

  it("rule 6: full boros with days left → hemat per hari (ceil ke ribuan)", () => {
    // dev ≈ 166.667, daysLeft = 11 → 166.667/11 ≈ 15.152 → ceil ribuan = 16.000.
    const insights = buildInsights(
      input({ active: budget({ ...FULL, spent: 800_000 }), todayTotal: 0 }),
    );
    expect(insights).toHaveLength(2);
    expect(insights[1]!.id).toBe("full-recover");
    expect(insights[1]!.short).toBe("Hemat Rp16rb/hari, balik normal.");
  });

  it("rule 6b: no recover nudge on the last day (daysLeft = 0)", () => {
    const insights = buildInsights(
      input({
        active: budget({ ...FULL, startDate: "2026-09-19", endDate: "2026-09-19", spent: 1_050_000, status: "over" }),
        todayTotal: 0,
      }),
    );
    expect(insights.map((i) => i.id)).toEqual(["full-boros"]);
  });

  it("rule 7: full hemat (below jalur beyond threshold) → mantap", () => {
    const insights = buildInsights(
      input({ active: budget({ ...FULL, spent: 400_000 }), todayTotal: 0 }),
    );
    expect(insights[0]!.id).toBe("full-hemat");
    expect(insights[0]!.short).toMatch(/^Hemat Rp2\d+rb sejauh ini, mantap\.$/);
    expect(insights[0]!.tone).toBe("ok");
  });

  it("full pace works across a month boundary (plan §6: lintas bulan)", () => {
    // Range 20 Agu – 19 Sep (31 days), today 19 Sep = day 31.
    const crossMonth = budget({
      type: "full",
      amount: 620_000,
      startDate: "2026-08-20",
      endDate: "2026-09-19",
      spent: 640_000,
      status: "ok",
    });
    // dev = 640.000 − 620.000 = 20.000 < threshold 62.000 → on track.
    const insights = buildInsights(input({ active: crossMonth, todayTotal: 0 }));
    expect(insights[0]!.id).toBe("full-track");
    expect(insights[0]!.short).toBe("Jalur aman, hari ke-31 dari 31.");
  });
});

describe("buildInsights — tanpa / di luar budget", () => {
  it("rule 8: tanpa budget aktif → pasang budget (info)", () => {
    const insights = buildInsights(input({ active: null }));
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe("no-budget");
    expect(insights[0]!.short).toBe("Pasang budget biar ada yang ngingetin.");
    expect(insights[0]!.tone).toBe("info");
  });

  it("finished period (endDate lewat) → satu info selesai, tanpa pace", () => {
    const insights = buildInsights(
      input({ active: budget({ startDate: "2026-08-01", endDate: "2026-08-31" }) }),
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe("finished");
    expect(insights[0]!.short).toBe("Budget selesai, bikin yang baru?");
  });

  it("upcoming budget (startDate belum mulai) → info mulai", () => {
    const insights = buildInsights(
      input({ active: budget({ startDate: "2026-10-01", endDate: "2026-10-31" }) }),
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe("upcoming");
    expect(insights[0]!.short).toBe("Budget mulai 01 Okt, santai dulu.");
  });

  it("today == endDate is still active (inclusive), not finished", () => {
    const insights = buildInsights(
      input({ active: budget({ startDate: "2026-09-19", endDate: "2026-09-19" }), todayTotal: 30_000 }),
    );
    expect(insights[0]!.id).toBe("daily-ok");
  });
});

describe("buildInsights — invariants", () => {
  it("PACE_DEVIATION_PCT is the documented 10%", () => {
    expect(PACE_DEVIATION_PCT).toBe(10);
  });

  it("pure: same input → same output", () => {
    const a = buildInsights(input());
    const b = buildInsights(input());
    expect(a).toEqual(b);
  });

  it("daily inputs ignore server spent for the headline (todayTotal wins)", () => {
    // Server spent (range) is huge, but daily rules only look at todayTotal.
    const insights = buildInsights(input({ todayTotal: 10_000, active: budget({ spent: 999_999, status: "over" }) }));
    expect(insights[0]!.id).toBe("daily-ok");
    expect(insights[0]!.short).toBe("Sisa Rp90rb hari ini, santai.");
  });
});
