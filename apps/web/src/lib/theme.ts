/**
 * Theme state (dark default, light switchable).
 * Single source of truth: `expense-app.theme` in localStorage with `"dark"`
 * as fallback. Applied on <html> via the `light`/`dark` class and mirrored
 * to the PWA status-bar `<meta name="theme-color">`.
 */

export type Theme = "dark" | "light";

const THEME_KEY = "expense-app.theme";
const META_SELECTOR = 'meta[name="theme-color"]';

let current: Theme = loadInitial();
const listeners = new Set<(theme: Theme) => void>();

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

function loadInitial(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage unavailable (private mode) → default.
  }
  return "dark";
}

/** Inline <style> overriding the manifest theme-color per theme. */
const THEME_COLORS: Record<Theme, string> = {
  dark: "#0a0a0a",
  light: "#F8F9FA",
};

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  if (!isTheme(theme)) return;
  current = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable — theme still applies for this session.
  }
  applyTheme();
}

export function toggleTheme(): Theme {
  const next: Theme = current === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function applyTheme(): void {
  // Storage is the source of truth (multi-tab safe): re-read on every apply.
  current = loadInitial();
  const root = document.documentElement;
  root.classList.add(current === "dark" ? "dark" : "light");
  root.classList.remove(current === "dark" ? "light" : "dark");
  root.style.colorScheme = current;
  document
    .querySelector(META_SELECTOR)
    ?.setAttribute("content", THEME_COLORS[current]);

  for (const listener of listeners) {
    listener(current);
  }
}

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
