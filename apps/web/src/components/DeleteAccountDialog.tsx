import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import { PIN_LENGTH } from "@expense-app/shared";

export interface DeleteAccountDialogProps {
  busy: boolean;
  /** Auth error shown inside the dialog (wrong PIN, 429, network). */
  error: string | null;
  onCancel: () => void;
  /** Called with the typed PIN when "Hapus Akun" is pressed. */
  onConfirm: (pin: string) => void;
}

const SANITIZE = /[^A-Z0-9]/g;

function sanitizePin(value: string): string {
  return value.toUpperCase().replace(SANITIZE, "").slice(0, PIN_LENGTH);
}

/**
 * Account deletion confirmation (plan §3): requires retyping the 6-char PIN
 * before "Hapus Akun" enables. Mirrors DeleteDialog: fixed overlay, Escape/
 * backdrop close, autofocus on cancel, busy disables everything. Auth errors
 * ("PIN salah.", 429/network) arrive via the `error` prop and keep the
 * dialog open. Testids: delete-account-dialog, -message, -pin, -cancel,
 * -confirm, -error.
 */
export function DeleteAccountDialog({ busy, error, onCancel, onConfirm }: DeleteAccountDialogProps) {
  const [pin, setPin] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    // Escape closes the dialog (backdrop-tap semantics), unless a request is
    // in flight — same guard as the backdrop onClick.
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  const valid = pin.length === PIN_LENGTH;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setPin(sanitizePin(event.target.value));
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const sanitized = sanitizePin(event.clipboardData.getData("text"));
    if (sanitized) {
      setPin(sanitized);
      event.preventDefault();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && valid && !busy) {
      event.preventDefault();
      onConfirm(pin);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Konfirmasi hapus akun"
      data-testid="delete-account-dialog"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-4 text-center text-sm font-medium text-neutral-100" data-testid="delete-account-message">
          Hapus akun? Riwayat tetap tersimpan. PIN ini bisa dipakai lagi dari awal.
        </p>

        <input
          ref={inputRef}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          maxLength={PIN_LENGTH}
          aria-label={`PIN ${PIN_LENGTH} karakter`}
          aria-busy={busy}
          data-testid="delete-account-pin"
          placeholder="••••••"
          value={pin}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          disabled={busy}
          className="h-11 w-full rounded-lg border border-neutral-700 bg-neutral-900 text-center text-lg font-light uppercase tracking-[0.3em] tabular-nums text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:opacity-40"
        />

        {error && (
          <p role="alert" data-testid="delete-account-error" className="mt-2 text-center text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="delete-account-cancel"
            className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800 disabled:opacity-40"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => onConfirm(pin)}
            disabled={!valid || busy}
            data-testid="delete-account-confirm"
            className="h-11 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white active:bg-red-700 disabled:opacity-40"
          >
            Hapus Akun
          </button>
        </div>
      </div>
    </div>
  );
}
