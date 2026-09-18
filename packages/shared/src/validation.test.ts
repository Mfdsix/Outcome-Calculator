import { describe, expect, it } from "vitest";

import { amountSchema, createExpenseSchema } from "./validation";

describe("validation", () => {
  it("accepts valid positive integer amounts", () => {
    expect(amountSchema.safeParse(35000).success).toBe(true);
    expect(amountSchema.safeParse(1).success).toBe(true);
    expect(amountSchema.safeParse(1_000_000_000_000).success).toBe(true);
  });

  it("rejects zero, negative, decimal and non-numeric amounts", () => {
    expect(amountSchema.safeParse(0).success).toBe(false);
    expect(amountSchema.safeParse(-5000).success).toBe(false);
    expect(amountSchema.safeParse(35.5).success).toBe(false);
    expect(amountSchema.safeParse(Number.NaN).success).toBe(false);
    expect(amountSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(amountSchema.safeParse("35000").success).toBe(false);
  });

  it("rejects amounts above the bounded maximum", () => {
    expect(amountSchema.safeParse(1_000_000_000_001).success).toBe(false);
  });

  it("accepts create payloads with or without occurredAt", () => {
    expect(createExpenseSchema.safeParse({ amount: 35000 }).success).toBe(true);
    expect(
      createExpenseSchema.safeParse({ amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" })
        .success,
    ).toBe(true);
    // occurredAt without offset is rejected (spec requires explicit offset).
    expect(
      createExpenseSchema.safeParse({ amount: 35000, occurredAt: "2026-09-17T12:30:00" }).success,
    ).toBe(false);
  });
});
