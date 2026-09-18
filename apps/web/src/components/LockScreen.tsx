import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";

import { PIN_LENGTH } from "@expense-app/shared";

export interface LockScreenProps {
  onSubmit: (code: string) => Promise<void>;
  error?: string | null;
  busy: boolean;
}

const SANITIZE = /[^A-Z0-9]/g;
const SUBMIT_DELAY = 600;

function sanitizeCode(value: string): string {
  return value.toUpperCase().replace(SANITIZE, "").slice(0, PIN_LENGTH);
}

export function LockScreen({ onSubmit, error, busy }: LockScreenProps) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const lastSubmittedRef = useRef("");
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    // Auto-submit exactly once per completed code: without the
    // lastSubmittedRef guard, the busy toggle re-runs this effect and
    // resubmits the same PIN (e.g. while the new-PIN dialog is open).
    if (
      code.length === PIN_LENGTH &&
      !submittingRef.current &&
      !busy &&
      code !== lastSubmittedRef.current
    ) {
      lastSubmittedRef.current = code;
      submittingRef.current = true;
      void onSubmit(code)
        .catch(() => {})
        .finally(() => {
          submittingRef.current = false;
        });
    }
  }, [code, busy, onSubmit]);

  useEffect(() => {
    if (error) {
      errorTimerRef.current = setTimeout(() => {
        setCode("");
        inputRef.current?.focus();
      }, SUBMIT_DELAY);
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  const handleContainerClick = (): void => {
    inputRef.current?.focus();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const sanitized = sanitizeCode(event.target.value);
    setCode(sanitized);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData("text");
    const sanitized = sanitizeCode(pasted);
    if (sanitized) {
      setCode(sanitized);
      event.preventDefault();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Backspace" && !code) {
      event.preventDefault();
    }
  };

  const renderSlot = (index: number): string => {
    return code[index] ?? "";
  };

  return (
    <div
      className="flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 px-4 mx-auto"
      data-testid="lock-screen"
      onClick={handleContainerClick}
    >
      <header className="flex w-full items-baseline justify-between px-1 pt-4">
        <span className="text-sm font-medium text-neutral-400">Pengeluaran</span>
        <span className="text-sm font-semibold tabular-nums text-neutral-100">🔒</span>
      </header>

      <p className="px-6 text-center text-xs text-neutral-500">
        PIN baru akan otomatis dibuatkan ruang sendiri — konfirmasi sekali, data lu terpisah dari orang lain.
      </p>

      <div className="relative flex justify-center">
        <span
          data-testid="lock-code-display"
          className={`text-4xl font-light uppercase tracking-[0.2em] tabular-nums text-neutral-100 ${error ? "animate-shake" : ""}`}
        >
          {Array.from({ length: PIN_LENGTH }, (_, i) => renderSlot(i) || "•").join(" ")}
        </span>
      </div>

      <div className="flex gap-1">
        {Array.from({ length: PIN_LENGTH }, (_, index) => {
          const filled = code[index] !== undefined;
          return (
            <div
              key={index}
              className={`h-1 w-6 rounded-t-sm transition-colors ${
                busy
                  ? "animate-pulse bg-neutral-600"
                  : error
                    ? "bg-red-700"
                    : filled
                      ? "bg-emerald-400"
                      : "bg-neutral-800"
              }`}
            />
          );
        })}
      </div>

      {error && (
        <p
          role="alert"
          data-testid="lock-error"
          className="text-center text-sm text-red-400"
        >
          {error}
        </p>
      )}
      {busy && (
        <p
          aria-live="polite"
          className="text-sm text-neutral-400"
        >
          Memeriksa...
        </p>
      )}

      <p className="text-xs text-neutral-500">
        PIN kamu = identitasmu • {PIN_LENGTH} karakter alfanumerik • otomatis terkirim
      </p>

      <input
        ref={inputRef}
        data-testid="lock-code-input"
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoFocus
        maxLength={PIN_LENGTH}
        aria-label={`PIN ${PIN_LENGTH} karakter`}
        aria-busy={busy}
        readOnly={busy}
        value={code}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="pointer-events-none absolute h-px w-px cursor-default overflow-clip border-0 bg-transparent p-0 whitespace-nowrap opacity-0 outline-none"
      />
    </div>
  );
}
