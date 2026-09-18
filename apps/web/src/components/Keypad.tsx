import type { ReactElement } from "react";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export interface KeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  enterDisabled: boolean;
  disabled?: boolean;
  /** Calculator mode: when editing, the backspace slot becomes a red delete
   * button that requests deletion of the edited transaction. */
  isEditing?: boolean;
   onDeleteRequest?: () => void;
   /** Special (history) mode: 2↑ 4← 6→ 8↓ navigate; Enter drills; rest inert.
    * navDisabled (special mode only) dims + disables individual directions. */
  layout?: "calc" | "special";
  onNavigate?: (direction: "up" | "down" | "left" | "right") => void;
  navDisabled?: Partial<Record<"up" | "down" | "left" | "right", boolean>>;
}

/**
 * Calculator keypad (spec §6). All targets ≥ 44 px tall.
 * Grid is always 4×3 in the same order (1-9 / 0 / ⌫ / Enter) so home and
 * history render at identical height. In "special" mode the digit keys at the
 * navigation positions (2↑ 4← 6→ 8↓) stay active; the remaining digits are
 * disabled and inert, Enter = drill.
 */
export function Keypad({
  onDigit,
  onBackspace,
  onEnter,
  enterDisabled,
  disabled,
  isEditing,
  onDeleteRequest,
  layout = "calc",
  onNavigate,
  navDisabled,
}: KeypadProps) {
  const isSpecial = layout === "special";

  type Spec = { label: string; testid: string; aria: string };
  const specs: Spec[] = [
    { label: "1", testid: "key-1", aria: "Digit 1" },
    { label: "2", testid: "key-2", aria: "Digit 2" },
    { label: "3", testid: "key-3", aria: "Digit 3" },
    { label: "4", testid: "key-4", aria: "Digit 4" },
    { label: "5", testid: "key-5", aria: "Digit 5" },
    { label: "6", testid: "key-6", aria: "Digit 6" },
    { label: "7", testid: "key-7", aria: "Digit 7" },
    { label: "8", testid: "key-8", aria: "Digit 8" },
    { label: "9", testid: "key-9", aria: "Digit 9" },
  ];

  const digitButton = (spec: Spec, digit: string): ReactElement => (
    <button
      key={spec.testid}
      type="button"
      data-testid={spec.testid}
      aria-label={`Digit ${digit}`}
      disabled={disabled}
      onClick={() => onDigit(digit)}
      className="key-button disabled:opacity-40"
    >
      {digit}
    </button>
  );

  const navButton = (spec: Spec, label: string, direction: "up" | "down" | "left" | "right"): ReactElement => (
    <button
      key={spec.testid}
      type="button"
      data-testid={spec.testid}
      aria-label={spec.aria}
      disabled={disabled || navDisabled?.[direction]}
      onClick={() => onNavigate?.(direction)}
      className="key-button disabled:opacity-40"
    >
      {label}
    </button>
  );

  const inertButton = (spec: Spec, label: string): ReactElement => (
    <button
      key={spec.testid}
      type="button"
      data-testid={spec.testid}
      aria-label={spec.aria}
      disabled={true}
      onClick={() => {}}
      className="key-button disabled:opacity-40"
    >
      {label}
    </button>
  );

  const renderCell = (spec: Spec): ReactElement => {
    if (isSpecial) {
      switch (spec.testid) {
        case "key-2":
          return navButton(spec, "↑", "up");
        case "key-4":
          return navButton(spec, "←", "left");
        case "key-6":
          return navButton(spec, "→", "right");
        case "key-8":
          return navButton(spec, "↓", "down");
        default:
          return inertButton(spec, spec.label);
      }
    }
    return digitButton(spec, spec.label);
  };

  return (
    <div className="grid grid-cols-3 gap-2 pb-4" data-testid="keypad">
      {specs.map((spec) => renderCell(spec))}

            <button
        type="button"
        data-testid="key-0"
        aria-label="Digit 0"
        disabled={isSpecial ? true : disabled}
        onClick={() => (!isSpecial ? onDigit("0") : undefined)}
        className="key-button disabled:opacity-40"
      >
        0
      </button>

      <button
        type="button"
        data-testid="key-backspace"
        aria-label={isSpecial ? "Backspace" : isEditing ? "Delete expense" : "Backspace"}
        disabled={isSpecial ? true : isEditing ? false : disabled}
        onClick={() =>
          isSpecial
            ? undefined
            : isEditing
              ? onDeleteRequest?.()
              : onBackspace()
        }
        className={`key-button ${isEditing && !isSpecial ? "text-red-400" : "text-neutral-300"} disabled:opacity-40`}
      >
        ⌫
      </button>

      <button
        type="button"
        data-testid="key-enter"
        aria-label="Enter"
        disabled={enterDisabled}
        onClick={onEnter}
        className="key-button bg-emerald-600 text-white shadow-[0_2px_0_0_#065f46] active:shadow-none disabled:bg-neutral-800 disabled:text-neutral-600 disabled:shadow-none"
      >
        Enter
      </button>
    </div>
  );
}
