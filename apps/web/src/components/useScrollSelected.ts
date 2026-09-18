import { useEffect, useRef, type RefObject } from "react";

/**
 * Keep the selected item scrolled into view (spec plan §3).
 * Called after `selectedKey` changes — covers keypad nav, keyboard arrows and
 * tap selection uniformly. Uses `block: "nearest"` + no animation so the jump
 * is instant and non-jarring during fast navigation. Optional-call guards
 * make it safe under jsdom where `scrollIntoView` may be absent.
 */
export function useScrollSelected(selectedKey: string | null): RefObject<HTMLButtonElement | null> {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedKey]);

  return ref;
}
