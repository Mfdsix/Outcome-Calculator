import { useEffect, useRef } from "react";

export interface DeleteDialogProps {
  amountLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Delete confirmation (spec §10): "Delete Rp35.000?" with Cancel/Delete. */
export function DeleteDialog({ amountLabel, busy, onCancel, onConfirm }: DeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm deletion"
      data-testid="delete-dialog"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-4 text-center text-sm font-medium text-neutral-100" data-testid="delete-dialog-message">
          Delete {amountLabel}?
        </p>
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="delete-cancel"
            className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="delete-confirm"
            className="h-11 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white active:bg-red-700 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
