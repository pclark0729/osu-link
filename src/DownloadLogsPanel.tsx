import { useMemo } from "react";
import { MainPaneSticky } from "./MainPaneSticky";
import type { DownloadLogEntry, DownloadLogSource } from "./downloadLog";

const SOURCE_LABEL: Record<DownloadLogSource, string> = {
  search: "Search",
  collection: "Collection",
  party: "Party",
};

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function DownloadLogsPanel({
  entries,
  onClear,
  onToast,
}: {
  entries: DownloadLogEntry[];
  onClear: () => void;
  onToast: (tone: "info" | "success" | "error", message: string) => void;
}) {
  const textDump = useMemo(() => {
    const lines = entries.map((e) => {
      const t = formatTime(e.at);
      const src = SOURCE_LABEL[e.source];
      const ok = e.status === "success";
      const tail = ok ? e.importPath ?? "" : e.errorMessage ?? "";
      return `${t}\t${src}\t#${e.beatmapsetId}\t${e.label}\t${ok ? "ok" : "error"}\t${tail}`;
    });
    return lines.join("\n");
  }, [entries]);

  const copyAll = async () => {
    if (entries.length === 0) {
      onToast("info", "Nothing to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(textDump);
      onToast("success", "Download log copied to clipboard.");
    } catch {
      onToast("error", "Could not copy to clipboard.");
    }
  };

  return (
    <div className="panel panel-elevated download-logs-panel">
      <MainPaneSticky>
        <div className="panel-head download-logs-head">
          <h2>Download log</h2>
          <p className="panel-sub panel-sub--flush-top">
            Recent beatmap imports from Search, Collections, and Party ({entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"}).
          </p>
          <div className="row-actions row-actions--spaced download-logs-actions">
            <button type="button" className="secondary" disabled={entries.length === 0} onClick={copyAll}>
              Copy as TSV
            </button>
            <button
              type="button"
              className="danger"
              disabled={entries.length === 0}
              onClick={() => {
                onClear();
                onToast("info", "Download log cleared.");
              }}
            >
              Clear log
            </button>
          </div>
        </div>
      </MainPaneSticky>

      {entries.length === 0 ? (
        <p className="hint download-logs-empty">
          No imports yet. When you download maps from Search, Collections, or Party, they appear here with
          status and import path.
        </p>
      ) : (
        <ul className="download-logs-list" aria-label="Download history">
          {entries.map((e) => (
            <li key={e.id} className={`download-logs-row download-logs-row--${e.status}`}>
              <div className="download-logs-row-main">
                <span className="download-logs-time" title={new Date(e.at).toISOString()}>
                  {formatTime(e.at)}
                </span>
                <span className="download-logs-source">{SOURCE_LABEL[e.source]}</span>
                <span className="download-logs-title" title={e.label}>
                  {e.label}
                </span>
                <span className="download-logs-setid">#{e.beatmapsetId}</span>
              </div>
              {e.status === "success" && e.importPath && (
                <p className="download-logs-detail download-logs-detail--path">{e.importPath}</p>
              )}
              {e.status === "error" && e.errorMessage && (
                <p className="download-logs-detail download-logs-detail--err">{e.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
