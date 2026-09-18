import { useEffect, useRef } from "react";

export interface NewPinDialogProps {
  /** Masked PIN for context, e.g. "•••123". */
  pinMask: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation before a never-seen PIN becomes a new identity (plan §3).
 * Mirrors DeleteDialog's structure/style. Honest limitation, stated in-copy:
 * a forgotten PIN cannot be recovered — the space would be unreachable.
 */
export function NewPinDialog({ pinMask, busy, onCancel, onConfirm }: NewPinDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm new PIN"
      data-testid="new-pin-dialog"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-1 text-center text-sm font-medium text-neutral-100" data-testid="new-pin-dialog-title">
          PIN baru — buat ruang milikmu?
        </p>
        <p className="mb-1 text-center text-2xl font-light tracking-[0.3em] tabular-nums text-neutral-300">
          {pinMask}
        </p>
        <p className="mb-4 text-center text-xs text-neutral-500">
          PIN lupa = ruang ini tidak bisa dibuka lagi (tanpa pemulihan).
        </p>
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="new-pin-cancel"
            className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800 disabled:opacity-40"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="new-pin-confirm"
            className="h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
          >
            Buat
          </button>
        </div>
      </div>
    </div>
  );
}
