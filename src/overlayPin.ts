import { invoke } from "@tauri-apps/api/core";

/** Re-apply Win32 topmost + always-on-top; retries help right after `WebviewWindow` creation. */
export async function scheduleOverlayPin(): Promise<void> {
  const delays = [0, 50, 200, 500];
  for (const ms of delays) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    await invoke("overlay_pin_topmost").catch(() => {});
  }
}
