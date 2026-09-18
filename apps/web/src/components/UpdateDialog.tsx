import { useEffect, useRef } from "react";

export interface UpdateDialogProps {
  fromLabel: string;
  toLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Update confirmation (spec plan §4c): "Update Rp35.000 → Rp50.000?" with
 * Cancel (emerald border) / Update (emerald fill). Mirrors DeleteDialog;
 * autofocuses Cancel; Escape and backdrop-cancel both abort to keep the
 * input intact for review.
 */
export function UpdateDialog({ fromLabel, toLabel, busy, onCancel, onConfirm }: UpdateDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm update"
      data-testid="update-dialog"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-4 text-center text-sm font-medium text-neutral-100" data-testid="update-dialog-message">
          Update {fromLabel} → {toLabel}?
        </p>
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="update-cancel"
            className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800 disabled:opacity-40"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="update-confirm"
            className="h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700 disabled:opacity-40"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
