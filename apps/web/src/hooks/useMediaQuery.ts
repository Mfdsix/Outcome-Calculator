import { useEffect, useState } from "react";

/**
 * SSR/jsdom-safe media query subscription. Returns false when matchMedia is
 * unavailable (jsdom tests default to the mobile path, keeping every existing
 * App.*.test.tsx untouched). Re-renders on query flips (resize / zoom).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    // Sync once in case the lazy initial state missed a pre-mount flip.
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
