import { useEffect, useRef, useState } from "react";

export interface UserMenuProps {
  /** Called after the auth token is cleared and the app must re-lock. */
  onLogout: () => void;
}

/**
 * Profile entry point (plan §3): user icon in the navbar's trailing slot.
 * Shows the masked PIN (never the raw passcode) and the logout item.
 * Closes via tap-outside, Escape, or after logout.
 */
export function UserMenu({ onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
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
            data-testid="user-menu-logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center px-3 py-2 text-left text-sm font-medium text-red-300 active:bg-neutral-800"
          >
            Keluar
          </button>
        </div>
      )}
    </div>
  );
}
