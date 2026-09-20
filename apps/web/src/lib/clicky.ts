/**
 * Clicky key feedback (shared by taps and physical-keyboard presses):
 * a 140ms brightness/press pulse on the matching `.key-button`, restartable
 * when the same key fires again quickly. Auto-cleans via animationend.
 */

const ACTIVE = new WeakMap<HTMLElement, number>();

export function triggerClicky(el: HTMLElement | null | undefined): void {
  if (!el || !(el instanceof HTMLElement)) return;
  el.classList.remove("key-clicky");
  // Force a style flush so re-adding restarts the animation mid-flight.
  void el.offsetWidth;
  el.classList.add("key-clicky");

  const previous = ACTIVE.get(el);
  if (previous !== undefined) clearTimeout(previous);

  const done = () => {
    el.classList.remove("key-clicky");
    ACTIVE.delete(el);
  };
  const timer = window.setTimeout(done, 150);
  ACTIVE.set(el, timer);
}

/** Find a keypad key element by its data-testid (scoped to the app root). */
export function keyEl(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

/** Digit → keypad testid ("key-1" … "key-0"). */
export function digitKeyTestId(digit: string): string {
  return digit === "0" ? "key-0" : `key-${digit}`;
}
