// The start page: start.html → this (session 4b). A person with an invite
// code creates their own demo hub. It shares the console's look
// (console.css) and two of its form pieces, nothing of the hub app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "../console/console.css";
import "./start.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
