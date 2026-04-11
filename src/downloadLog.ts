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

export function newDownloadLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
