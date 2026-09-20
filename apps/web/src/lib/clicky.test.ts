import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { digitKeyTestId, triggerClicky } from "./clicky";

describe("lib/clicky", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds .key-clicky to the element on trigger", () => {
    const el = document.createElement("button");
    el.className = "key-button";

    triggerClicky(el);

    expect(el.classList.contains("key-clicky")).toBe(true);
  });

  it("removes the class after the animation window", () => {
    const el = document.createElement("button");
    el.className = "key-button";

    triggerClicky(el);
    vi.advanceTimersByTime(200);

    expect(el.classList.contains("key-clicky")).toBe(false);
  });

  it("ignores null / non-element targets", () => {
    expect(() => triggerClicky(null)).not.toThrow();
    expect(() => triggerClicky(undefined)).not.toThrow();
  });

  it("maps digits to keypad testids (incl. zero)", () => {
    expect(digitKeyTestId("5")).toBe("key-5");
    expect(digitKeyTestId("0")).toBe("key-0");
  });
});
