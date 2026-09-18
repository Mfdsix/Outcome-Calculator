export interface ControlBarProps {
  selectedKey: string | null;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
}

/**
 * Special-mode control bar: Edit / Hapus / Kembali (spec plan §4).
 * No arrow keys — those are on the special keypad remap.
 */
export function ControlBar({ selectedKey, canEdit, busy, onEdit, onDelete, onBack }: ControlBarProps) {
  return (
    <div className="flex gap-2 pb-4 pt-2" data-testid="control-bar">
      <button
        type="button"
        data-testid="control-edit"
        aria-label="Edit"
        disabled={!canEdit || busy}
        onClick={onEdit}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm font-semibold text-neutral-100 active:bg-neutral-800 disabled:opacity-40"
      >
        Edit
      </button>
      <button
        type="button"
        data-testid="control-delete"
        aria-label="Hapus"
        disabled={!selectedKey || busy}
        onClick={onDelete}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-red-900/70 bg-red-950/40 px-3 text-sm font-semibold text-red-300 active:bg-red-900/40 disabled:opacity-40"
      >
        Hapus
      </button>
      <button
        type="button"
        data-testid="control-back"
        aria-label="Kembali"
        onClick={onBack}
        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm font-semibold text-neutral-100 active:bg-neutral-800"
      >
        ←
      </button>
    </div>
  );
}
