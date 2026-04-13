export type DownloadLogSource = "search" | "collection" | "party";

export type DownloadLogEntry = {
  id: string;
  at: number;
  source: DownloadLogSource;
  beatmapsetId: number;
  label: string;
  status: "success" | "error";
  importPath?: string;
  errorMessage?: string;
};

export const DOWNLOAD_LOG_MAX = 400;

/** Survives app restarts and Tauri updates (stored in the webview profile). */
export const DOWNLOAD_LOG_STORAGE_KEY = "osu-link.download-log.v1";

function isDownloadLogSource(s: unknown): s is DownloadLogSource {
  return s === "search" || s === "collection" || s === "party";
}

export function loadDownloadLogs(): DownloadLogEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(DOWNLOAD_LOG_STORAGE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    const out: DownloadLogEntry[] = [];
    for (const x of p) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const { id, at, source, beatmapsetId, label, status } = o;
      if (typeof id !== "string" || typeof at !== "number" || !isDownloadLogSource(source)) continue;
      if (typeof beatmapsetId !== "number" || typeof label !== "string") continue;
      if (status !== "success" && status !== "error") continue;
      const row: DownloadLogEntry = { id, at, source, beatmapsetId, label, status };
      if (typeof o.importPath === "string") row.importPath = o.importPath;
      if (typeof o.errorMessage === "string") row.errorMessage = o.errorMessage;
      out.push(row);
    }
    out.sort((a, b) => b.at - a.at);
    return out.slice(0, DOWNLOAD_LOG_MAX);
  } catch {
    return [];
  }
}

export function saveDownloadLogs(entries: DownloadLogEntry[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DOWNLOAD_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota */
  }
}

export function newDownloadLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
