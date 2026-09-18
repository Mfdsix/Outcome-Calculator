import { useEffect, useRef } from "react";

export interface UnsavedDialogProps {
  onSave: () => void;
  onCancel: () => void;
}

/** "Data belum tersimpan." confirmation (spec plan §4e): appear only when leaving
 * edit with unsaved changes. Save routes through the normal Enter/confirmUpdate
 * path (UpdateDialog reuse); Cancel reverts the edit and restores history.
 * Escape + backdrop + Cancel both just close this dialog (stay in edit). */
export function UnsavedDialog({ onSave, onCancel }: UnsavedDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Unsaved changes"
      data-testid="unsaved-dialog"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p
          className="mb-4 text-center text-sm font-medium text-neutral-100"
          data-testid="unsaved-dialog-message"
        >
          Data belum tersimpan.
        </p>
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            data-testid="unsaved-cancel"
            className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
          >
            Kembali
          </button>
          <button
            type="button"
            onClick={onSave}
            data-testid="unsaved-confirm"
            className="h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white active:bg-emerald-700"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
