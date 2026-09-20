import { useEffect, useState } from "react";

import { IS_TAURI } from "../lib/tauri";

/**
 * Small dismissible banner prompting the user to reload when a new service
 * worker has finished installing (registerType: "prompt" in vite.config).
 * Skipped in the Tauri shell: assets are bundled into the app binary, so
 * there is no service worker (and nothing to update) in that runtime.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (IS_TAURI) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;

    const watch = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && !cancelled && registration.waiting) {
          setWaiting(true);
        }
      } catch {
        // SW not available (dev / insecure context) — nothing to do.
      }
    };

    void watch();
    const onUpdating = (): void => setWaiting(true);
    navigator.serviceWorker.addEventListener("controllerchange", onUpdating);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onUpdating);
    };
  }, []);

  if (!waiting || dismissed) return null;

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300"
    >
      <span>Pembaruan tersedia.</span>
      <button
        type="button"
        data-testid="update-banner-reload"
        onClick={() => {
          setDismissed(true);
          void navigator.serviceWorker.getRegistration().then((registration) => {
            registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
            registration?.waiting?.addEventListener("statechange", (event) => {
              const worker = event.target as ServiceWorker;
              if (worker.state === "activated") window.location.reload();
            });
          });
        }}
        className="rounded-md border border-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100 active:bg-neutral-800"
      >
        Muat ulang
      </button>
    </div>
  );
}
