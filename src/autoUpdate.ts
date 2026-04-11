import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** True when the packaged app can use the updater (not dev server, not browser). */
export function updaterAvailable(): boolean {
  return isTauri() && !import.meta.env.DEV;
}

export type ManualUpdateResult =
  | { kind: "skipped" }
  | { kind: "upToDate" }
  | { kind: "cancelled" }
  | { kind: "installed"; version: string }
  | { kind: "error"; message: string };

/** Check GitHub Releases (latest.json), download, install, and relaunch if newer than current build. */
export async function runAutoUpdate(): Promise<void> {
  if (!updaterAvailable()) {
    return;
  }
  try {
    const update = await check();
    if (!update) {
      return;
    }
    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    console.warn("Auto-update check failed:", err);
  }
}

/**
 * User-initiated check: optionally confirm, then download, install, and relaunch.
 * Returns a result for toasts; on success the app typically exits before the promise settles.
 */
export async function checkForUpdatesAndInstall(): Promise<ManualUpdateResult> {
  if (!updaterAvailable()) {
    return { kind: "skipped" };
  }
  try {
    const update = await check();
    if (!update) {
      return { kind: "upToDate" };
    }
    const v = update.version;
    const ok = window.confirm(`Install osu-link ${v} and restart now?`);
    if (!ok) {
      return { kind: "cancelled" };
    }
    await update.downloadAndInstall();
    await relaunch();
    return { kind: "installed", version: v };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}
