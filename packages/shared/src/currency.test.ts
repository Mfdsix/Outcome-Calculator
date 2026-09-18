import { describe, expect, it } from "vitest";

import { digitsToAmount, formatIDR, formatIDRAbbreviated, groupDigits, normalizeDigits } from "./currency";

describe("currency", () => {
  it("normalizes digits and strips leading zeros", () => {
    expect(normalizeDigits("")).toBe("");
    expect(normalizeDigits("0")).toBe("0");
    expect(normalizeDigits("00035")).toBe("35");
    expect(normalizeDigits("007")).toBe("7");
    expect(normalizeDigits("12a3")).toBe("123");
  });

  it("groups digits Indonesian style", () => {
    expect(groupDigits("")).toBe("0");
    expect(groupDigits("0")).toBe("0");
    expect(groupDigits("500")).toBe("500");
    expect(groupDigits("1000")).toBe("1.000");
    expect(groupDigits("35000")).toBe("35.000");
    expect(groupDigits("1250000")).toBe("1.250.000");
  });

  it("parses digit strings to integer amounts", () => {
    expect(digitsToAmount("")).toBe(0);
    expect(digitsToAmount("0")).toBe(0);
    expect(digitsToAmount("00035")).toBe(35);
    expect(digitsToAmount("1250000")).toBe(1_250_000);
  });

  it("formats full IDR amounts", () => {
    expect(formatIDR(0)).toBe("Rp0");
    expect(formatIDR(500)).toBe("Rp500");
    expect(formatIDR(35000)).toBe("Rp35.000");
    expect(formatIDR(127500)).toBe("Rp127.500");
    expect(formatIDR(1_250_000)).toBe("Rp1.250.000");
  });

  it("abbreviates very large totals", () => {
    expect(formatIDRAbbreviated(1_200_000)).toBe("Rp1,2 jt");
    expect(formatIDRAbbreviated(3_840_000)).toBe("Rp3,8 jt");
    expect(formatIDRAbbreviated(2_500_000_000)).toBe("Rp2,5 M");
    expect(formatIDRAbbreviated(127_500)).toBe("Rp127.500");
  });
});
