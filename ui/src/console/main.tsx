// The super admin's page: console.html → this. It shares nothing with the
// hub app's bundle; ui/eslint.config.js keeps the hub app from importing it.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./console.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
