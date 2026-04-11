import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isTauri } from "@tauri-apps/api/core";

const STORAGE_KEY = "osu-link.desktop-notifications.v1";

export function loadDesktopNotificationsEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function saveDesktopNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

async function ensureNotifyPermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const p = await requestPermission();
    granted = p === "granted";
  }
  return granted;
}

/** OS toast when the app is in the background; no-op in browser or when disabled. */
export async function notifyDesktop(title: string, body?: string): Promise<void> {
  if (!isTauri() || !loadDesktopNotificationsEnabled()) return;
  try {
    const ok = await ensureNotifyPermission();
    if (!ok) return;
    sendNotification(body != null && body.length > 0 ? { title, body } : { title });
  } catch {
    /* ignore — notifications are best-effort */
  }
}
