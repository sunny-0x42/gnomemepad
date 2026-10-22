import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.scss";
import App from "./App.jsx";
import { applyTheme, loadPrefs } from "./lib/prefs";

// Theme before paint
applyTheme(loadPrefs().theme);

// PWA: force new SW so buy-path fixes are not stuck on cache-first JS.
// Dev skips the worker. A cached shell on :5174 leaves a blank page.
if (import.meta.env.DEV && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    for (const reg of regs || []) reg.unregister();
  }).catch(() => {});
} else if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .getRegistrations?.()
      .then((regs) => {
        // Keep only latest registration after re-register below
        return Promise.all((regs || []).map((r) => r.update?.() || Promise.resolve()));
      })
      .catch(() => {})
      .finally(() => {
        navigator.serviceWorker
          .register(`/sw.js?v=11`)
          .then((reg) => {
            reg.update?.();
            if (reg.waiting) {
              reg.waiting.postMessage?.({ type: "SKIP_WAITING" });
            }
            // Force clients to take control of new SW
            if (navigator.serviceWorker.controller) {
              reg.active?.postMessage?.({ type: "SKIP_WAITING" });
            }
          })
          .catch(() => {});
      });
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
