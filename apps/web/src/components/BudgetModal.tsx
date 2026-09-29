import { useEffect, useState } from "react";

export interface BudgetModalProps {
  /** null = closed; 'form' = create/replace form; 'kelola' = manage (Ganti/Hapus/history/use-again). */
  mode: "form" | "kelola" | null;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Generic modal shell (plan §A — "Keputusan user yang dikunci: ... form jadi modal").
 * Overlay: fixed inset-0, backdrop-blur, Escape closes modal first (captured here
 * before App.tsx's bubble-phase handler), backdrop click closes. Scale + opacity
 * transition via CSS (tailwindcss-animate plugin not installed — manual transition).
 */
export function BudgetModal({ mode, onClose, children }: BudgetModalProps) {
  const [mounted, setMounted] = useState(false);

  // Escape: close the modal first. This listener uses the capture phase so it
  // intercepts Escape BEFORE App.tsx registers its bubble-phase handler —
  // stopPropagation prevents App.tsx from then closing the BudgetScreen.
  useEffect(() => {
    if (mode === null) return;
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeydown, { capture: true });
    return () => window.removeEventListener("keydown", onKeydown, { capture: true });
  }, [mode, onClose]);

  // Mount-triggered transition (appear).
  useEffect(() => {
    setMounted(true);
  }, []);

  if (mode === null) return null;

  return (
    <div
      data-testid="budget-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => onClose()}
    >
      <div
        data-testid="budget-modal-panel"
        className={`relative w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900/95 p-5 shadow-xl transition-all duration-200 ${
          mounted ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
