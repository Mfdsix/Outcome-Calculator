export type Period = "day" | "week" | "month";

/**
 * View modes (locked special-mode contract):
 * - "calculator": half-D default — Header / AmountDisplay / navbar /
 *   hourly BarChart / calc Keypad.
 * - "special": D/W/M browse — navbar + SummaryList/BrowseList + chart
 *   selectedKey + special Keypad, with drill-down into a
 *   selected bucket.
 */
export type ViewMode = "calculator" | "special";

/** Where the special browse list currently is. */
export type SpecialPanel = "summary" | "drill";
