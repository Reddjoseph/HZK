// double-guard: ensure Buffer & process exist in modules too
import { Buffer } from "buffer";
import process from "process";

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
  globalThis.Buffer = globalThis.Buffer || Buffer;

  window.process = window.process || process;
  globalThis.process = globalThis.process || process;
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
