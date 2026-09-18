import type { ReactElement } from "react";

export interface EditActionsProps {
  onBack: () => void;
  onDelete: () => void;
}

/** Floating action strip that appears while editing a transaction (spec plan §4d).
 * Back (neutral) returns to history origin; Delete (red) opens the existing
 * DeleteDialog for the edited item. Rendered only when calc.isEditing. */
export function EditActions({ onBack, onDelete }: EditActionsProps): ReactElement {
  return (
    <div
      data-testid="edit-actions"
      className="pointer-events-auto absolute inset-x-4 top-[calc(4rem+1px)] z-30 flex gap-2 rounded-xl border border-neutral-800 bg-neutral-900/90 px-3 py-2 backdrop-blur"
    >
      <button
        type="button"
        data-testid="edit-back"
        onClick={onBack}
        className="h-10 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
      >
        ← Back
      </button>
      <button
        type="button"
        data-testid="edit-delete"
        onClick={onDelete}
        className="h-10 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white active:bg-red-700"
      >
        🗑 Delete
      </button>
    </div>
  );
}
