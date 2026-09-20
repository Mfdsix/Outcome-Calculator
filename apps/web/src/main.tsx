import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app/App";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA (plan §3): production-only service worker registration. In dev/tests
// the virtual module is absent and nothing happens.
if (import.meta.env.PROD) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedRefresh: () => {
        // UpdateBanner listens to the waiting worker itself; nothing to do here.
      },
    });
  });
}
