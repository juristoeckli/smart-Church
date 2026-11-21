import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AccountSetupPage } from "./AccountSetupInvitation";
import "./styles.css";
import "./events.css";
import "./dark-mode.css";
import "./auth.css";
import "./community.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/^\/account-setup\/?$/.test(window.location.pathname) ? <AccountSetupPage /> : <App />}
  </React.StrictMode>,
);
