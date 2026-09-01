import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./operations.css";
import "./payments.css";
import "./production.css";
import "./a11y.css";
import "./login-a11y.css";
import "./reference-v3.css";
import "./brand-overrides.css";
import "./cinematic-actions.css";
import "./table-lifecycle.css";
import "./destructive-actions.css";
import "./action-feedback.css";
import "./qr-modal-overrides.css";
import "./offline.css";
import "./waiter-alerts.css";
import "./service-requests.css";
import "./alert-sounds.css";
import "./dashboard-polish.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
