import { useEffect, useRef, useState } from "react";

import type { BudgetStatus } from "@expense-app/shared";

import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { ApiError, authApi } from "../lib/api";

export interface UserMenuProps {
  /** Called after the auth token is cleared and the app must re-lock. */
  onLogout: () => void;
  /** Called after account deactivation succeeds (token cleared, re-lock). */
  onAccountDeleted: () => void;
  /** Current active budget status (for the status dot on the menu item). */
  budgetStatus: BudgetStatus | null;
  /** Opens the budget screen. */
  onOpenBudget: () => void;
  /** Opens the insight screen. */
  onOpenInsight: () => void;
}

  /**
   * Profile entry point (plan §3): user icon in the navbar's trailing slot.
   * Shows the masked PIN (never the raw passcode), then a single divider and
   * the action items: "Hapus akun" (red + trash icon) and "Keluar" (neutral +
   * logout icon). The destructive delete flow opens a PIN-confirmation dialog
   * owned by this component. Closes via tap-outside, Escape, or after
   * logout/deletion.
   */
export function UserMenu({ onLogout, onAccountDeleted, budgetStatus, onOpenBudget, onOpenInsight }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const confirmDeleteAccount = async (pin: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setDialogError(null);
    try {
      await authApi.deactivate(pin);
      // Success: close everything, let App clear the token and re-lock.
      setShowDeleteDialog(false);
      setOpen(false);
      onAccountDeleted();
    } catch (cause) {
      // 401 wrong PIN → "PIN salah."; 429 → rate-limit copy; network →
      // generic. The dialog stays open either way.
      setDialogError(
        cause instanceof ApiError && cause.status === 429
          ? "Terlalu banyak percobaan. Coba lagi nanti."
          : cause instanceof ApiError && cause.status === 0
            ? "Tidak ada koneksi. Coba lagi."
            : cause instanceof Error
              ? cause.message
              : "Gagal menghapus akun. Coba lagi.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="Menu pengguna"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="user-menu-button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-200"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profil"
          data-testid="user-menu"
          className="absolute right-0 top-12 z-40 w-48 rounded-xl border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            data-testid="user-menu-pin"
          >
            <span className="text-xs text-neutral-500">PIN</span>
            <span className="text-sm font-medium tabular-nums text-neutral-200">••••••</span>
          </div>
          <div className="mx-3 border-t border-neutral-800" />

          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-budget"
            onClick={() => {
              setOpen(false);
              onOpenBudget();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-neutral-200 active:bg-neutral-800"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5v9A2.5 2.5 0 0 1 16.5 19h-11A2.5 2.5 0 0 1 3 16.5z" />
              <circle cx="16.5" cy="12" r="0.5" fill="currentColor" />
            </svg>
            <span className="flex-1">Budget</span>
            {budgetStatus !== null && (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  budgetStatus === "over"
                    ? "bg-red-400"
                    : budgetStatus === "warning"
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                }`}
                aria-label={budgetStatus}
              />
            )}
          </button>

          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-insight"
            onClick={() => {
              setOpen(false);
              onOpenInsight();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-neutral-200 active:bg-neutral-800"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="10.5" x2="12" y2="16.5" />
              <circle cx="12" cy="7.5" r="0.5" fill="currentColor" />
            </svg>
            Insight
          </button>

          <div className="mx-3 my-1 border-t border-neutral-800" />

          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-delete-account"
            onClick={() => {
              setOpen(false);
              setDialogError(null);
              setShowDeleteDialog(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-red-300 active:bg-neutral-800"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M9 9V4a3 3 0 0 1 6 0v5" />
              <path d="M10 12v6" />
              <path d="M14 12v6" />
              <rect x="5" y="12" width="14" height="8" rx="1" />
            </svg>
            Hapus akun
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-neutral-200 active:bg-neutral-800"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 18l6-6-6-6" />
              <path d="M15 12H4" />
              <path d="M5 5V3" />
              <circle cx="18" cy="18" r="3" />
            </svg>
            Keluar
          </button>
        </div>
      )}

      {showDeleteDialog && (
        <DeleteAccountDialog
          busy={busy}
          error={dialogError}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={(pin) => void confirmDeleteAccount(pin)}
        />
      )}
    </div>
  );
}
