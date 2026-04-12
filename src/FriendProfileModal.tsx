import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { ACHIEVEMENTS } from "./achievements/catalog";
import { PlayerRankCard } from "./PlayerRankCard";
import { computeOsuPerformanceRank } from "./playerRank";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import { parseUserRulesetPayload, type ParsedRow } from "./SocialLeaderboard";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const MODE_OPTIONS: NeuSelectOption[] = [
  { value: "osu", label: "osu!" },
  { value: "taiko", label: "Taiko" },
  { value: "fruits", label: "Catch" },
  { value: "mania", label: "Mania" },
];

export function FriendProfileModal({
  open,
  onClose,
  osuId,
  username,
  socialGet,
}: {
  open: boolean;
  onClose: () => void;
  osuId: number;
  username: string;
  socialGet: (path: string) => Promise<unknown>;
}) {
  const [mode, setMode] = useState("osu");
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<ParsedRow | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [achievements, setAchievements] = useState<Array<{ achievementId: string; earnedAtMs: number }>>([]);
  const [achErr, setAchErr] = useState<string | null>(null);
  const [osuRank, setOsuRank] = useState(() => computeOsuPerformanceRank([]));

  const load = useCallback(async () => {
    if (!open || !isTauri()) return;
    setBusy(true);
    setLoadErr(null);
    setAchErr(null);
    setRow(null);
    try {
      const rawProfile = await invoke<unknown>("osu_user_profile", { userId: osuId });
      const rawStats = await invoke<unknown>("osu_user_ruleset_stats", { userId: osuId, mode });
      const pr = asRecord(rawProfile);
      const name = String(pr.username ?? username);
      const parsed = parseUserRulesetPayload(rawStats, name);
      setRow(parsed);

      const rankRows: ParsedRow[] = [];
      const modes = ["osu", "taiko", "fruits", "mania"] as const;
      const statsResults = await Promise.all(
        modes.map((m) => invoke<unknown>("osu_user_ruleset_stats", { userId: osuId, mode: m }).catch(() => null)),
      );
      for (let i = 0; i < modes.length; i++) {
        const raw = statsResults[i];
        const rowParsed = raw ? parseUserRulesetPayload(raw, modes[i]) : null;
        if (rowParsed) rankRows.push(rowParsed);
      }
      setOsuRank(computeOsuPerformanceRank(rankRows));
    } catch (e) {
      setRow(null);
      setLoadErr(String(e));
      setOsuRank(computeOsuPerformanceRank([]));
    }

    try {
      const aj = asRecord(await socialGet(`/api/v1/users/${osuId}/achievements`));
      const list = aj.achievements;
      if (Array.isArray(list)) {
        setAchievements(
          list
            .map((x) => {
              const r = asRecord(x);
              return {
                achievementId: String(r.achievementId ?? r.achievement_id ?? ""),
                earnedAtMs: Number(r.earnedAtMs ?? r.earned_at_ms),
              };
            })
            .filter((x) => x.achievementId && Number.isFinite(x.earnedAtMs)),
        );
      } else {
        setAchievements([]);
      }
      setAchErr(null);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("403") || msg.includes("forbidden")) {
        setAchErr("Achievements are only visible for accepted friends.");
      } else {
        setAchErr(msg);
      }
      setAchievements([]);
    } finally {
      setBusy(false);
    }
  }, [open, osuId, username, mode, socialGet]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const byId = new Map(achievements.map((a) => [a.achievementId, a.earnedAtMs]));

  return (
    <div className="modal-overlay friend-profile-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-sheet friend-profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="friend-profile-head">
          {row?.avatarUrl ? (
            <img className="friend-profile-avatar" src={row.avatarUrl} alt="" width={56} height={56} />
          ) : null}
          <div>
            <h2 className="friend-profile-title">{row?.username ?? username}</h2>
            <p className="friend-profile-sub">Profile · {osuId}</p>
          </div>
          <button type="button" className="toast-dismiss" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="friend-profile-mode">
          <NeuSelect value={mode} options={MODE_OPTIONS} onChange={(v) => setMode(v)} />
        </div>

        {busy && !row && !loadErr ? <p className="hint">Loading…</p> : null}
        {loadErr ? <p className="hint friend-profile-err">{loadErr}</p> : null}

        <div className="friend-profile-rank">
          <PlayerRankCard info={osuRank} variant="compact" />
        </div>

        {row && !row.error ? (
          <div className="friend-profile-stats-grid">
            <div className="friend-profile-stat">
              <span className="friend-profile-stat-label">PP</span>
              <span className="friend-profile-stat-value">{row.pp != null ? Math.round(row.pp).toLocaleString() : "—"}</span>
            </div>
            <div className="friend-profile-stat">
              <span className="friend-profile-stat-label">Global rank</span>
              <span className="friend-profile-stat-value">
                {row.globalRank != null ? `#${row.globalRank.toLocaleString()}` : "—"}
              </span>
            </div>
            <div className="friend-profile-stat">
              <span className="friend-profile-stat-label">Accuracy</span>
              <span className="friend-profile-stat-value">
                {row.accuracy != null ? `${row.accuracy.toFixed(2)}%` : "—"}
              </span>
            </div>
            <div className="friend-profile-stat">
              <span className="friend-profile-stat-label">Play count</span>
              <span className="friend-profile-stat-value">
                {row.playCount != null ? row.playCount.toLocaleString() : "—"}
              </span>
            </div>
          </div>
        ) : null}

        <h3 className="friend-profile-h3">osu!link achievements</h3>
        {achErr ? <p className="hint">{achErr}</p> : null}
        {!achErr && achievements.length === 0 ? (
          <p className="hint">No achievements synced yet.</p>
        ) : null}
        <ul className="friend-profile-badges">
          {ACHIEVEMENTS.map((def) => {
            const t = byId.get(def.id);
            if (!t) return null;
            return (
              <li key={def.id} className="friend-profile-badge">
                <span className={`achievement-tile-tier achievement-tile-tier--${def.tier}`}>{def.tier}</span>
                <span className="friend-profile-badge-title">{def.title}</span>
                <span className="friend-profile-badge-date">
                  {new Date(t).toLocaleDateString(undefined, { dateStyle: "medium" })}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
