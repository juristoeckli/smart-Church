import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AccountSetupPage } from "./AccountSetupInvitation";
import { LegalDocuments } from "./LegalDocuments";
import "./styles.css";
import "./events.css";
import "./dark-mode.css";
import "./auth.css";
import "./community.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/^\/account-setup\/?$/.test(window.location.pathname)
      ? <AccountSetupPage />
      : window.location.pathname === "/privacy-policy" || window.location.pathname === "/privacy-policy/"
        ? <LegalDocuments page="privacy" />
        : window.location.pathname === "/terms-of-service" || window.location.pathname === "/terms-of-service/"
          ? <LegalDocuments page="terms" />
          : <App />}
  </React.StrictMode>,
);
