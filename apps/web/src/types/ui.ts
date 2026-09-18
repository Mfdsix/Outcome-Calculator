export type Period = "day" | "week" | "month";

/**
 * View modes (locked special-mode contract):
 * - "calculator": half-D default — Header / AmountDisplay / navbar /
 *   hourly BarChart / calc Keypad.
 * - "special": D/W/M browse — navbar + SummaryList/BrowseList + chart
 *   selectedKey + special Keypad, with drill-down into a
 *   selected bucket.
 * - "budget": dedicated budget screen (plan §3) — active card + history
 *   ("Pakai lagi") + create form. Digits stay inert; keypad never blocked.
 */
export type ViewMode = "calculator" | "special" | "budget";

/** Where the special browse list currently is. */
export type SpecialPanel = "summary" | "drill";

/** Snapshot of history state captured on edit, so Back can restore it. */
export interface EditOrigin {
  period: Period;
  panel: SpecialPanel;
  drillDayKey: string | null;
  selectedKey: string | null;
}
