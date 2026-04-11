import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { OverlayApp } from "./OverlayApp";
import { runAutoUpdate } from "./autoUpdate";

/** Packaged builds: check GitHub for updates as soon as the UI loads (every launch). */
void runAutoUpdate();

const rootLabel = isTauri() ? getCurrentWindow().label : "main";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {rootLabel === "overlay" ? <OverlayApp /> : <App />}
  </React.StrictMode>,
);
