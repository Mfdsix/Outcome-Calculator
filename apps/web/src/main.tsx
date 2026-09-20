import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app/App";
import { applyTheme } from "./lib/theme";
import "./index.css";

// Theme before first paint: restores the persisted light/dark class on <html>
// so there is no dark flash when the user picked light mode.
applyTheme();

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
