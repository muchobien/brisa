import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PwaUpdates } from "./pwa/PwaUpdates";
import "./design-system/tokens.css";
import "./design-system/components.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <PwaUpdates />
  </StrictMode>,
);
