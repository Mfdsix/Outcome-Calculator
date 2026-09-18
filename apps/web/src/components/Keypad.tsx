export interface KeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  enterDisabled: boolean;
  disabled?: boolean;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * Calculator keypad (spec §6). All targets ≥ 44 px tall.
 * Digit entry flows through onDigit/onBackspace/onEnter so the keypad can be
 * reused in any mode; the parent owns whether each handler is active.
 */
export function Keypad({ onDigit, onBackspace, onEnter, enterDisabled, disabled }: KeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-2 pb-4" data-testid="keypad">
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          data-testid={`key-${digit}`}
          aria-label={`Digit ${digit}`}
          disabled={disabled}
          onClick={() => onDigit(digit)}
          className="key-button disabled:opacity-40"
        >
          {digit}
        </button>
      ))}

      <button
        type="button"
        data-testid="key-0"
        aria-label="Digit 0"
        disabled={disabled}
        onClick={() => onDigit("0")}
        className="key-button disabled:opacity-40"
      >
        0
      </button>

      <button
        type="button"
        data-testid="key-backspace"
        aria-label="Backspace"
        disabled={disabled}
        onClick={onBackspace}
        className="key-button text-neutral-300 disabled:opacity-40"
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
