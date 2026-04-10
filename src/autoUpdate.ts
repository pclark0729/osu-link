import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Check GitHub Releases (latest.json), download, install, and relaunch if newer than current build. */
export async function runAutoUpdate(): Promise<void> {
  if (!isTauri() || import.meta.env.DEV) {
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
