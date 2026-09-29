import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadTickerVisible, saveTickerVisible } from "./tickerPref";

describe("lib/tickerPref", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to true when no key is set", () => {
    expect(loadTickerVisible()).toBe(true);
  });

  it("round-trips false → true correctly", () => {
    saveTickerVisible(false);
    expect(localStorage.getItem("expense-app.insight-ticker-visible")).toBe("false");
    expect(loadTickerVisible()).toBe(false);

    saveTickerVisible(true);
    expect(localStorage.getItem("expense-app.insight-ticker-visible")).toBe("true");
    expect(loadTickerVisible()).toBe(true);
  });

  it("parses falsy strings ('false', '0', 'off') as hidden", () => {
    localStorage.setItem("expense-app.insight-ticker-visible", "false");
    expect(loadTickerVisible()).toBe(false);

    localStorage.setItem("expense-app.insight-ticker-visible", "0");
    expect(loadTickerVisible()).toBe(false);

    localStorage.setItem("expense-app.insight-ticker-visible", "off");
    expect(loadTickerVisible()).toBe(false);
  });

  it("treats corrupt or unknown values as visible (true)", () => {
    localStorage.setItem("expense-app.insight-ticker-visible", "garbage");
    expect(loadTickerVisible()).toBe(true);

    localStorage.setItem("expense-app.insight-ticker-visible", "");
    expect(loadTickerVisible()).toBe(true);
  });

  it("falls back to default when localStorage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadTickerVisible()).toBe(true);
  });

  it("does not throw on save when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveTickerVisible(false)).not.toThrow();
    expect(() => saveTickerVisible(true)).not.toThrow();
  });
});
