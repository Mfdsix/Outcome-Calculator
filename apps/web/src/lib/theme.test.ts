import { beforeEach, describe, expect, it } from "vitest";

import { applyTheme, getTheme, setTheme, toggleTheme } from "./theme";

describe("lib/theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    setTheme("dark");
  });

  it("defaults to dark", () => {
    expect(getTheme()).toBe("dark");
  });

  it("setTheme('light') switches, persists and applies the class", () => {
    setTheme("light");

    expect(getTheme()).toBe("light");
    expect(localStorage.getItem("expense-app.theme")).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies dark by default (class + color-scheme)", () => {
    applyTheme();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("toggleTheme flips dark → light → dark", () => {
    expect(toggleTheme()).toBe("light");
    expect(getTheme()).toBe("light");
    expect(toggleTheme()).toBe("dark");
    expect(getTheme()).toBe("dark");
  });

  it("restores the persisted theme on applyTheme", () => {
    localStorage.setItem("expense-app.theme", "light");
    document.documentElement.className = "";

    applyTheme();

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(getTheme()).toBe("light");
  });
});
