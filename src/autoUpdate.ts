import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
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

export { check };

/** Download, install, and relaunch (used after user confirms). */
export async function applyUpdateAndRelaunch(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
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
      await update.close();
      return { kind: "cancelled" };
    }
    await applyUpdateAndRelaunch(update);
    return { kind: "installed", version: v };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }
}
