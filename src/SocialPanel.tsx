import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import { SocialLeaderboard } from "./SocialLeaderboard";

type SocialSub = "friends" | "activity" | "battles" | "challenges" | "leaderboard";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function scoreBeatmapsetId(s: Record<string, unknown>): number | null {
  const bm = s.beatmap;
  if (bm && typeof bm === "object") {
    const n = Number((bm as Record<string, unknown>).beatmapset_id);
    if (Number.isFinite(n)) return n;
  }
  const bs = s.beatmapset;
  if (bs && typeof bs === "object") {
    const n = Number((bs as Record<string, unknown>).id);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function scoreTotalFromOsu(s: Record<string, unknown>): number | null {
  const n = Number(s.score);
  return Number.isFinite(n) ? n : null;
}

function extractOsuFriendsList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as { friends?: unknown; data?: unknown };
    if (Array.isArray(o.friends)) return o.friends;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

function isAcceptedFriendStatus(status: string): boolean {
  return String(status).toLowerCase().trim() === "accepted";
}

function parseChallengeRulesDisplay(r: Record<string, unknown>): { artist: string; title: string } | null {
  const raw = r.rules_json;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const d = o.display;
  if (!d || typeof d !== "object") return null;
  const dr = d as Record<string, unknown>;
  const title = String(dr.title ?? "").trim();
  const artist = String(dr.artist ?? "").trim();
  if (!title && !artist) return null;
  return { title: title || "—", artist: artist || "—" };
}

const CHALLENGE_DEADLINE_PRESET_OPTIONS: NeuSelectOption[] = [
  { value: "", label: "Choose deadline…" },
  { value: "86400000", label: "24 hours" },
  { value: "259200000", label: "3 days" },
  { value: "604800000", label: "7 days" },
  { value: "1209600000", label: "14 days" },
  { value: "custom", label: "Custom date & time…" },
];

/** osu! API /friends entries → osu id + label for pickers */
function osuWebFriendRows(raw: unknown): Array<{ osuId: number; label: string }> {
  const list = extractOsuFriendsList(raw);
  const out: Array<{ osuId: number; label: string }> = [];
  for (const u of list) {
    const r = asRecord(u);
    const target = asRecord(r.target ?? r);
    const id = Number(target.id ?? r.id);
    if (!Number.isFinite(id)) continue;
    const name = String(target.username ?? r.username ?? "—").trim() || "—";
    out.push({ osuId: id, label: `${name} (${id})` });
  }
  return out;
}

export function SocialPanel({
  onToast,
}: {
  onToast: (tone: "info" | "success" | "error", message: string) => void;
}) {
  const [sub, setSub] = useState<SocialSub>("friends");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [meId, setMeId] = useState<number | null>(null);
  /** osu! id from OAuth `/me` when party-server `/api/v1/me` is unavailable */
  const [oauthOsuId, setOauthOsuId] = useState<number | null>(null);
  const [localFriends, setLocalFriends] = useState<
    Array<{
      friendshipId: number;
      osuId: number;
      username: string;
      status: string;
      requestedBy: number;
      createdAt: number;
    }>
  >([]);
  const [osuFriendsRaw, setOsuFriendsRaw] = useState<unknown>(null);
  const [osuFriendsErr, setOsuFriendsErr] = useState<string | null>(null);

  const [activityEvents, setActivityEvents] = useState<
    Array<{ id: number; actor_osu_id: number; type: string; payload: string | null; created_at: number }>
  >([]);
  const [activityLoadErr, setActivityLoadErr] = useState<string | null>(null);

  const [battles, setBattles] = useState<unknown[]>([]);
  /** Friend osu id as string, or "" */
  const [battleOpponentFriend, setBattleOpponentFriend] = useState("");
  const [battleOpponentManual, setBattleOpponentManual] = useState("");
  const [battleMapQuery, setBattleMapQuery] = useState("");
  const [battleMapResults, setBattleMapResults] = useState<Array<{ id: number; title: string; artist: string }>>([]);
  const [battleMapSearching, setBattleMapSearching] = useState(false);
  const [battlePick, setBattlePick] = useState<{ id: number; title: string; artist: string } | null>(null);

  const [challenges, setChallenges] = useState<unknown[]>([]);
  const [challengeMapQuery, setChallengeMapQuery] = useState("");
  const [challengeMapResults, setChallengeMapResults] = useState<Array<{ id: number; title: string; artist: string }>>([]);
  const [challengeMapSearching, setChallengeMapSearching] = useState(false);
  const [challengePick, setChallengePick] = useState<{ id: number; title: string; artist: string } | null>(null);
  const [challengeSelectValue, setChallengeSelectValue] = useState("");
  const [chDeadlinePreset, setChDeadlinePreset] = useState("");
  const [chDeadlineCustom, setChDeadlineCustom] = useState("");

  const [leaderboardSignal, setLeaderboardSignal] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const battlePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const socialGet = useCallback(async (path: string) => {
    return invoke<unknown>("social_api_get", { path });
  }, []);

  const socialPost = useCallback(async (path: string, body?: Record<string, unknown>) => {
    return invoke<unknown>("social_api_post", { path, body: body ?? null });
  }, []);

  const socialDelete = useCallback(async (path: string) => {
    return invoke<unknown>("social_api_delete", { path });
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const j = asRecord(await socialGet("/api/v1/me"));
      const u = asRecord(j.user);
      const id = Number(u.osu_id);
      if (Number.isFinite(id)) setMeId(id);
    } catch {
      setMeId(null);
    }
  }, [socialGet]);

  const refreshOauthOsuId = useCallback(async () => {
    try {
      const st = await invoke<{ loggedIn: boolean; osuId?: number | null }>("auth_status");
      const raw = st.osuId;
      const id = raw != null ? Number(raw) : null;
      setOauthOsuId(Number.isFinite(id) ? id : null);
    } catch {
      setOauthOsuId(null);
    }
  }, []);

  const refreshLocalFriends = useCallback(async () => {
    try {
      const j = asRecord(await socialGet("/api/v1/friends"));
      const friends = j.friends;
      if (!Array.isArray(friends)) {
        setLocalFriends([]);
        return;
      }
      setLocalFriends(
        friends.map((x) => {
          const r = asRecord(x);
          return {
            friendshipId: Number(r.friendshipId),
            osuId: Number(r.osuId),
            username: String(r.username ?? ""),
            status: String(r.status ?? ""),
            requestedBy: Number(r.requestedBy),
            createdAt: Number(r.createdAt),
          };
        }),
      );
    } catch {
      setLocalFriends([]);
    }
  }, [socialGet]);

  const loadOsuFriends = useCallback(async () => {
    try {
      const v = await invoke<unknown>("osu_friends");
      setOsuFriendsRaw(v);
      setOsuFriendsErr(null);
    } catch (e) {
      setOsuFriendsRaw(null);
      setOsuFriendsErr(String(e));
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    try {
      const raw = await socialGet("/api/v1/activity?limit=40");
      const j = asRecord(raw);
      const ev = j.events;
      if (!Array.isArray(ev)) {
        setActivityEvents([]);
        setActivityLoadErr(null);
        return;
      }
      setActivityLoadErr(null);
      setActivityEvents(
        ev.map((x) => {
          const r = asRecord(x);
          return {
            id: Number(r.id),
            actor_osu_id: Number(r.actor_osu_id),
            type: String(r.type),
            payload: r.payload == null ? null : String(r.payload),
            created_at: Number(r.created_at),
          };
        }),
      );
    } catch (e) {
      setActivityLoadErr(String(e));
      setActivityEvents([]);
    }
  }, [socialGet]);

  const refreshBattles = useCallback(async () => {
    const j = asRecord(await socialGet("/api/v1/battles"));
    const b = j.battles;
    setBattles(Array.isArray(b) ? b : []);
  }, [socialGet]);

  const refreshChallenges = useCallback(async () => {
    const j = asRecord(await socialGet("/api/v1/challenges"));
    const c = j.challenges;
    setChallenges(Array.isArray(c) ? c : []);
  }, [socialGet]);

  const runRefresh = useCallback(async () => {
    setErr(null);
    setBusy(true);
    try {
      await Promise.all([refreshMe(), refreshOauthOsuId()]);
      // Do not block osu! website friends on party-server `/friends` (missing URL or API errors).
      await Promise.all([refreshLocalFriends(), loadOsuFriends()]);
      if (sub === "activity") await refreshActivity();
      if (sub === "battles") await refreshBattles();
      if (sub === "challenges") await refreshChallenges();
      if (sub === "leaderboard") setLeaderboardSignal((s) => s + 1);
    } catch (e) {
      const msg = String(e);
      setErr(msg);
      onToast("error", msg);
    } finally {
      setBusy(false);
    }
  }, [
    refreshMe,
    refreshOauthOsuId,
    refreshLocalFriends,
    loadOsuFriends,
    refreshActivity,
    refreshBattles,
    refreshChallenges,
    sub,
    onToast,
  ]);

  useEffect(() => {
    void runRefresh();
  }, []);

  useEffect(() => {
    if (sub !== "activity") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void refreshActivity().catch(() => {});
    }, 12_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sub, refreshActivity]);

  useEffect(() => {
    if (sub === "activity") void refreshActivity().catch(() => {});
  }, [sub, refreshActivity]);

  useEffect(() => {
    if (sub === "battles") void refreshBattles().catch(() => {});
    if (sub === "challenges") void refreshChallenges().catch(() => {});
  }, [sub, refreshBattles, refreshChallenges]);

  useEffect(() => {
    if (sub !== "battles" && sub !== "leaderboard" && sub !== "challenges") return;
    void refreshLocalFriends().catch(() => {});
    void loadOsuFriends().catch(() => {});
  }, [sub, refreshLocalFriends, loadOsuFriends]);

  useEffect(() => {
    if (sub !== "battles") {
      if (battlePollRef.current) {
        clearInterval(battlePollRef.current);
        battlePollRef.current = null;
      }
      return;
    }
    battlePollRef.current = setInterval(() => {
      void refreshBattles().catch(() => {});
    }, 15_000);
    return () => {
      if (battlePollRef.current) clearInterval(battlePollRef.current);
    };
  }, [sub, refreshBattles]);

  useEffect(() => {
    if (sub !== "battles") return;
    const q = battleMapQuery.trim();
    if (q.length < 2) {
      setBattleMapResults([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setBattleMapSearching(true);
        try {
          const res = await invoke<Record<string, unknown>>("search_beatmapsets", {
            input: { q, s: "ranked", sort: "plays_desc", m: 0 },
          });
          const sets = (res.beatmapsets as unknown[]) || [];
          const out: Array<{ id: number; title: string; artist: string }> = [];
          for (const x of sets.slice(0, 12)) {
            const r = asRecord(x);
            const id = Number(r.id);
            if (!Number.isFinite(id)) continue;
            out.push({
              id,
              title: String(r.title ?? ""),
              artist: String(r.artist ?? ""),
            });
          }
          setBattleMapResults(out);
        } catch {
          setBattleMapResults([]);
        } finally {
          setBattleMapSearching(false);
        }
      })();
    }, 380);
    return () => clearTimeout(t);
  }, [battleMapQuery, sub]);

  useEffect(() => {
    if (sub !== "challenges") return;
    const q = challengeMapQuery.trim();
    if (q.length < 2) {
      setChallengeMapResults([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setChallengeMapSearching(true);
        try {
          const res = await invoke<Record<string, unknown>>("search_beatmapsets", {
            input: { q, s: "ranked", sort: "plays_desc", m: 0 },
          });
          const sets = (res.beatmapsets as unknown[]) || [];
          const out: Array<{ id: number; title: string; artist: string }> = [];
          for (const x of sets.slice(0, 12)) {
            const r = asRecord(x);
            const id = Number(r.id);
            if (!Number.isFinite(id)) continue;
            out.push({
              id,
              title: String(r.title ?? ""),
              artist: String(r.artist ?? ""),
            });
          }
          setChallengeMapResults(out);
        } catch {
          setChallengeMapResults([]);
        } finally {
          setChallengeMapSearching(false);
        }
      })();
    }, 380);
    return () => clearTimeout(t);
  }, [challengeMapQuery, sub]);

  useEffect(() => {
    if (!challengePick) return;
    if (!challengeMapResults.some((m) => m.id === challengePick.id)) {
      setChallengePick(null);
      setChallengeSelectValue("");
    }
  }, [challengeMapResults, challengePick]);

  const [targetId, setTargetId] = useState("");

  const sendFriendRequest = async () => {
    const id = Number(targetId.trim());
    if (!Number.isFinite(id)) {
      onToast("error", "Enter a numeric osu! user id.");
      return;
    }
    setBusy(true);
    try {
      await socialPost("/api/v1/friends/request", { targetOsuId: id });
      onToast("success", "Friend request sent.");
      setTargetId("");
      await refreshLocalFriends();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptFriend = async (friendshipId: number) => {
    setBusy(true);
    try {
      await socialPost("/api/v1/friends/accept", { friendshipId });
      onToast("success", "Friend request accepted.");
      await refreshLocalFriends();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeFriend = async (osuId: number) => {
    setBusy(true);
    try {
      await socialDelete(`/api/v1/friends/${osuId}`);
      onToast("success", "Removed.");
      await refreshLocalFriends();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const createBattle = async () => {
    const opp =
      battleOpponentFriend !== "" ? Number(battleOpponentFriend) : Number(battleOpponentManual.trim());
    if (!battlePick || !Number.isFinite(opp)) {
      onToast("error", "Choose an opponent and a beatmap from search.");
      return;
    }
    setBusy(true);
    try {
      await socialPost("/api/v1/battles", {
        opponentOsuId: opp,
        beatmapsetId: battlePick.id,
      });
      onToast("success", "Battle created — you have 48 hours to submit scores.");
      setBattleMapQuery("");
      setBattleMapResults([]);
      setBattlePick(null);
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitBattleFromOsu = async (battleId: number, beatmapsetId: number) => {
    const uid = meId ?? oauthOsuId;
    if (uid == null) {
      onToast("error", "Sign in with osu! so we can read your recent scores.");
      return;
    }
    setBusy(true);
    try {
      const raw = await invoke<unknown>("osu_user_recent_scores", { userId: uid, limit: 100, mode: "osu" });
      const list = Array.isArray(raw) ? raw : [];
      let best: number | null = null;
      for (const item of list) {
        const s = asRecord(item);
        const sid = scoreBeatmapsetId(s);
        if (sid !== beatmapsetId) continue;
        const tot = scoreTotalFromOsu(s);
        if (tot == null) continue;
        if (best == null || tot > best) best = tot;
      }
      if (best == null) {
        onToast(
          "error",
          "No recent osu! score on this beatmap set. Play it in osu! (stable), then use “Submit from osu!” again.",
        );
        return;
      }
      await socialPost(`/api/v1/battles/${battleId}/submit`, { score: best, mods: 0 });
      onToast("success", `Submitted score ${best.toLocaleString()} from your osu! recent scores.`);
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitBattleManual = async (battleId: number) => {
    const raw = window.prompt("Enter your score (honor system):");
    if (raw == null) return;
    const score = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(score)) return;
    setBusy(true);
    try {
      await socialPost(`/api/v1/battles/${battleId}/submit`, { score, mods: 0 });
      onToast("success", "Score submitted.");
      await refreshBattles();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const createChallenge = async () => {
    if (!challengePick) {
      onToast("error", "Search and select a ranked beatmap set.");
      return;
    }
    let deadlineMs: number | null = null;
    if (chDeadlinePreset === "custom") {
      if (!chDeadlineCustom.trim()) {
        onToast("error", "Pick a date and time for the deadline.");
        return;
      }
      const ms = new Date(chDeadlineCustom).getTime();
      deadlineMs = Number.isFinite(ms) ? ms : null;
    } else if (chDeadlinePreset) {
      const offset = Number(chDeadlinePreset);
      deadlineMs = Number.isFinite(offset) ? Date.now() + offset : null;
    }
    if (deadlineMs == null || !Number.isFinite(deadlineMs)) {
      onToast("error", "Choose a deadline preset or a valid custom date & time.");
      return;
    }
    setBusy(true);
    try {
      await socialPost("/api/v1/challenges", {
        beatmapsetId: challengePick.id,
        deadlineMs,
        rulesJson: {
          display: { title: challengePick.title, artist: challengePick.artist },
        },
      });
      onToast("success", "Challenge created.");
      setChallengeMapQuery("");
      setChallengeMapResults([]);
      setChallengePick(null);
      setChallengeSelectValue("");
      setChDeadlinePreset("");
      setChDeadlineCustom("");
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const joinChallenge = async (id: number) => {
    setBusy(true);
    try {
      await socialPost(`/api/v1/challenges/${id}/join`, {});
      onToast("success", "Joined challenge.");
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitChallengeFromOsu = async (challengeId: number, beatmapsetId: number) => {
    if (meId == null) {
      onToast("error", "Sign in with osu! so we can read your recent scores.");
      return;
    }
    setBusy(true);
    try {
      const raw = await invoke<unknown>("osu_user_recent_scores", { userId: meId, limit: 100, mode: "osu" });
      const list = Array.isArray(raw) ? raw : [];
      let best: number | null = null;
      for (const item of list) {
        const s = asRecord(item);
        const sid = scoreBeatmapsetId(s);
        if (sid !== beatmapsetId) continue;
        const tot = scoreTotalFromOsu(s);
        if (tot == null) continue;
        if (best == null || tot > best) best = tot;
      }
      if (best == null) {
        onToast(
          "error",
          "No recent osu! score on this beatmap set. Play it in osu! (stable), then use “Submit from osu!” again.",
        );
        return;
      }
      await socialPost(`/api/v1/challenges/${challengeId}/submit`, { score: best, mods: 0 });
      onToast("success", `Submitted score ${best.toLocaleString()} from your osu! recent scores.`);
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitChallengeManual = async (id: number) => {
    const raw = window.prompt("Enter your score (honor system):");
    if (raw == null) return;
    const score = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(score)) return;
    setBusy(true);
    try {
      await socialPost(`/api/v1/challenges/${id}/submit`, { score, mods: 0 });
      onToast("success", "Score submitted.");
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptedFriends = localFriends.filter((f) => isAcceptedFriendStatus(f.status));

  /** Party-server id when linked; otherwise osu! OAuth `/me` so the leaderboard always includes you when signed in. */
  const selfOsuId = useMemo(() => meId ?? oauthOsuId, [meId, oauthOsuId]);

  const displayNameForOsu = useCallback(
    (osuId: number) => {
      if (selfOsuId != null && osuId === selfOsuId) return "You";
      const f = localFriends.find((x) => x.osuId === osuId);
      if (f?.username) return f.username;
      return `User ${osuId}`;
    },
    [selfOsuId, localFriends],
  );

  const leaderboardParticipants = useMemo(() => {
    const out: Array<{ osuId: number; label: string }> = [];
    const seen = new Set<number>();
    if (selfOsuId != null) {
      seen.add(selfOsuId);
      out.push({ osuId: selfOsuId, label: "You" });
    }
    for (const f of acceptedFriends) {
      if (seen.has(f.osuId)) continue;
      seen.add(f.osuId);
      out.push({ osuId: f.osuId, label: f.username || `User ${f.osuId}` });
    }
    for (const row of osuWebFriendRows(osuFriendsRaw)) {
      if (selfOsuId != null && row.osuId === selfOsuId) continue;
      if (seen.has(row.osuId)) continue;
      seen.add(row.osuId);
      const name = row.label.replace(/\s*\(\d+\)\s*$/, "").trim() || row.label;
      out.push({ osuId: row.osuId, label: name });
    }
    return out;
  }, [selfOsuId, acceptedFriends, osuFriendsRaw]);

  const friendSelectOptions: NeuSelectOption[] = useMemo(() => {
    const seen = new Set<string>();
    const opts: NeuSelectOption[] = [{ value: "", label: "Choose a friend…" }];
    const add = (value: string, label: string) => {
      if (selfOsuId != null && value === String(selfOsuId)) return;
      if (seen.has(value)) return;
      seen.add(value);
      opts.push({ value, label });
    };
    for (const f of acceptedFriends) {
      add(String(f.osuId), `${f.username} (${f.osuId})`);
    }
    for (const row of osuWebFriendRows(osuFriendsRaw)) {
      add(String(row.osuId), row.label);
    }
    return opts;
  }, [acceptedFriends, osuFriendsRaw, selfOsuId]);

  const challengeMapSelectOptions: NeuSelectOption[] = useMemo(() => {
    const hint = challengeMapSearching ? "Searching…" : "Search below, then choose a set…";
    const opts: NeuSelectOption[] = [{ value: "", label: hint }];
    for (const m of challengeMapResults) {
      opts.push({
        value: String(m.id),
        label: `${m.artist} — ${m.title} (#${m.id})`,
      });
    }
    return opts;
  }, [challengeMapResults, challengeMapSearching]);

  const osuFriendsList = extractOsuFriendsList(osuFriendsRaw);

  return (
    <div className="panel panel-elevated">
      <div className="panel-head">
        <h2>Social</h2>
      </div>

      {err && <div className="error-banner">{err}</div>}

      <div className="social-tab-bar" role="tablist" aria-label="Social sections">
        <div className="social-tab-group">
          {(
            [
              ["friends", "Friends"],
              ["activity", "Activity"],
              ["battles", "Battles"],
              ["challenges", "Challenges"],
              ["leaderboard", "Leaderboard"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={sub === k}
              className={`social-tab ${sub === k ? "primary" : "secondary"}`}
              onClick={() => setSub(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary social-tab-refresh"
          disabled={busy}
          onClick={() => void runRefresh()}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>

      {sub === "friends" && (
        <div className="social-section">
          <div className="social-subsection">
            <h3 className="social-h3">osu-link friends (server)</h3>
            <div className="social-card">
              <div className="grid-2">
                <label className="field">
                  <span>Request friendship (osu! user id)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="e.g. 1706431"
                  />
                </label>
                <div className="social-card-actions">
                  <button type="button" className="primary" disabled={busy} onClick={() => void sendFriendRequest()}>
                    Send request
                  </button>
                </div>
              </div>
            </div>
            <ul className="social-list social-friend-list">
              {localFriends.map((f) => (
                <li key={f.friendshipId} className="social-friend-row">
                  <div className="social-friend-meta">
                    <span className="social-friend-name">{f.username}</span>
                    <span className="social-friend-id">({f.osuId})</span>
                    <span className={`social-status social-status-${f.status}`}>{f.status}</span>
                  </div>
                  <div className="social-friend-actions">
                    {f.status === "pending" && f.requestedBy !== selfOsuId && (
                      <button type="button" className="secondary small-btn" onClick={() => void acceptFriend(f.friendshipId)}>
                        Accept
                      </button>
                    )}
                {isAcceptedFriendStatus(f.status) && (
                  <button type="button" className="danger small-btn" onClick={() => void removeFriend(f.osuId)}>
                    Remove
                  </button>
                )}
                  </div>
                </li>
              ))}
              {localFriends.length === 0 && (
                <li className="hint social-list-empty">No entries yet.</li>
              )}
            </ul>
          </div>

          <div className="social-subsection">
            <h3 className="social-h3">osu! website friends</h3>
            <p className="hint social-subsection-hint">Requires OAuth re-login with friends.read.</p>
            {osuFriendsErr && <div className="error-banner">{osuFriendsErr}</div>}
            <ul className="social-list social-friend-list social-osu-web-list">
              {osuFriendsList.map((u: unknown, i: number) => {
                const r = asRecord(u);
                const target = asRecord(r.target ?? r);
                const id = Number(target.id ?? r.id);
                const name = String(target.username ?? r.username ?? "—");
                return (
                  <li key={typeof id === "number" && !Number.isNaN(id) ? id : i} className="social-friend-row social-osu-web-row">
                    <span className="social-friend-name">{name}</span>
                    {Number.isFinite(id) ? <span className="social-friend-id">{id}</span> : null}
                  </li>
                );
              })}
              {osuFriendsList.length === 0 && (
                <li className="hint social-list-empty">None loaded.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {sub === "activity" && (
        <div className="social-section social-activity-section">
          {activityLoadErr && <div className="error-banner">{activityLoadErr}</div>}
          <p className="hint social-activity-intro">Latest actions from your social server (updates every ~12s while this tab is open).</p>
          <ul className="social-list social-activity-list">
            {activityEvents.map((e) => (
              <li key={e.id} className="social-activity-row">
                <div className="social-activity-head">
                  <span className="tag social-activity-type">{e.type}</span>
                  <span className="social-activity-actor">User {e.actor_osu_id}</span>
                  <time className="social-activity-time" dateTime={new Date(e.created_at).toISOString()}>
                    {new Date(e.created_at).toLocaleString()}
                  </time>
                </div>
                {e.payload && <pre className="social-payload">{e.payload}</pre>}
              </li>
            ))}
            {activityEvents.length === 0 && (
              <li className="hint social-list-empty">No visible events yet.</li>
            )}
          </ul>
        </div>
      )}

      {sub === "battles" && (
        <div className="social-section social-battle-section">
          <p className="hint social-battle-intro">
            Pick someone to battle and a ranked map. The time window (48 hours) and score submission from your osu!
            profile are handled for you.
          </p>
          <div className="social-card social-battle-form">
            <div className="grid-2">
              <label className="field">
                <span>Opponent</span>
                <NeuSelect
                  value={battleOpponentFriend}
                  disabled={busy}
                  options={friendSelectOptions}
                  onChange={(v) => {
                    setBattleOpponentFriend(v);
                    if (v) setBattleOpponentManual("");
                  }}
                />
              </label>
              <label className="field">
                <span>Or osu! user id</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={battleOpponentManual}
                  onChange={(e) => {
                    setBattleOpponentManual(e.target.value);
                    if (e.target.value.trim()) setBattleOpponentFriend("");
                  }}
                  placeholder="Anyone not in the list"
                />
              </label>
            </div>
            <div className="battle-map-panel">
              <div className="battle-map-panel-header">
                <span className="battle-map-panel-title">Map</span>
                <span className="battle-map-panel-sub">Ranked beatmaps · search by artist or title</span>
              </div>
              <label className="field battle-map-search-field">
                <span>Search</span>
                <input
                  type="text"
                  value={battleMapQuery}
                  onChange={(e) => setBattleMapQuery(e.target.value)}
                  placeholder="Type at least 2 characters…"
                  autoComplete="off"
                />
              </label>
              {battleMapSearching && (
                <p className="hint battle-map-search-status" aria-live="polite">
                  Searching…
                </p>
              )}
              {battleMapResults.length > 0 && (
                <div className="battle-map-results-wrap">
                  <span className="battle-map-results-label">Results</span>
                  <ul className="battle-map-pick-list" role="listbox" aria-label="Ranked search results">
                    {battleMapResults.map((m) => {
                      const selected = battlePick?.id === m.id;
                      const pickMap = () => {
                        setBattlePick(m);
                        setBattleMapResults([]);
                        setBattleMapQuery("");
                      };
                      return (
                        <li
                          key={m.id}
                          role="option"
                          aria-selected={selected}
                          tabIndex={0}
                          className={`battle-map-pick-option ${selected ? "is-selected" : ""}`}
                          onClick={pickMap}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              pickMap();
                            }
                          }}
                        >
                          <span className="battle-map-pick-title">
                            {m.artist} — {m.title}
                          </span>
                          <span className="battle-map-pick-id">#{m.id}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {battlePick && (
                <div className="battle-selected-strip">
                  <span className="battle-selected-label">Selected map</span>
                  <p className="battle-selected-body">
                    <strong>{battlePick.title}</strong>
                    <span className="battle-selected-dash"> — </span>
                    {battlePick.artist}
                    <span className="hint battle-selected-set"> · set {battlePick.id}</span>
                  </p>
                </div>
              )}
            </div>
            <div className="row-actions social-battle-primary-row">
              <button type="button" className="primary" disabled={busy} onClick={() => void createBattle()}>
                Start battle
              </button>
            </div>
            <p className="hint social-battle-footnote">
              Each battle closes 48 hours after creation unless both players have submitted.
            </p>
          </div>
          <h3 className="social-h3 social-battle-list-heading">Your battles</h3>
          <ul className="social-list social-battle-list">
            {battles.map((b) => {
              const r = asRecord(b);
              const id = Number(r.id);
              const creator = Number(r.creator_osu_id);
              const opponent = Number(r.opponent_osu_id);
              const setId = Number(r.beatmapset_id);
              const end = Number(r.window_end);
              const state = String(r.state);
              const windowOpen = Number.isFinite(end) && Date.now() <= end;
              const canTrySubmit = state !== "closed" && windowOpen;
              return (
                <li key={id} className="battle-row">
                  <div className="battle-row-main">
                    <span className="battle-row-title">
                      {displayNameForOsu(creator)} <span className="hint">vs</span> {displayNameForOsu(opponent)}
                    </span>
                    <span className="hint">
                      set #{setId} · {state}
                      {Number.isFinite(end) ? ` · ends ${new Date(end).toLocaleString()}` : ""}
                      {r.winner_osu_id != null ? ` · winner ${displayNameForOsu(Number(r.winner_osu_id))}` : ""}
                    </span>
                  </div>
                  {canTrySubmit && (
                    <span className="battle-row-actions">
                      <button
                        type="button"
                        className="primary small-btn"
                        disabled={busy}
                        onClick={() => void submitBattleFromOsu(id, setId)}
                      >
                        Submit from osu!
                      </button>
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={busy}
                        onClick={() => void submitBattleManual(id)}
                      >
                        Enter score…
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sub === "challenges" && (
        <div className="social-section social-challenge-section">
          <p className="hint social-challenge-intro">
            Open challenges on a beatmap set; participants join and submit scores before the deadline.
          </p>
          <div className="social-card social-challenge-form">
            <div className="battle-map-panel">
              <div className="battle-map-panel-header">
                <span className="battle-map-panel-title">Map</span>
                <span className="battle-map-panel-sub">Ranked beatmaps · search, then pick from the list</span>
              </div>
              <label className="field battle-map-search-field">
                <span>Search</span>
                <input
                  type="text"
                  value={challengeMapQuery}
                  onChange={(e) => setChallengeMapQuery(e.target.value)}
                  placeholder="Type at least 2 characters…"
                  autoComplete="off"
                />
              </label>
              {challengeMapSearching && (
                <p className="hint battle-map-search-status" aria-live="polite">
                  Searching…
                </p>
              )}
              <label className="field">
                <span>Beatmap set</span>
                <NeuSelect
                  value={challengeSelectValue}
                  disabled={busy}
                  options={challengeMapSelectOptions}
                  onChange={(v) => {
                    setChallengeSelectValue(v);
                    if (!v) {
                      setChallengePick(null);
                      return;
                    }
                    const m = challengeMapResults.find((x) => String(x.id) === v);
                    setChallengePick(m ?? null);
                  }}
                />
              </label>
              {challengePick && (
                <div className="battle-selected-strip">
                  <span className="battle-selected-label">Selected map</span>
                  <p className="battle-selected-body">
                    <strong>{challengePick.title}</strong>
                    <span className="battle-selected-dash"> — </span>
                    {challengePick.artist}
                    <span className="hint battle-selected-set"> · set {challengePick.id}</span>
                  </p>
                </div>
              )}
            </div>
            <div className="grid-2">
              <label className="field">
                <span>Deadline</span>
                <NeuSelect
                  value={chDeadlinePreset}
                  disabled={busy}
                  options={CHALLENGE_DEADLINE_PRESET_OPTIONS}
                  onChange={(v) => {
                    setChDeadlinePreset(v);
                    if (v !== "custom") setChDeadlineCustom("");
                  }}
                />
              </label>
              {chDeadlinePreset === "custom" && (
                <label className="field">
                  <span>Date &amp; time</span>
                  <input
                    type="datetime-local"
                    value={chDeadlineCustom}
                    onChange={(e) => setChDeadlineCustom(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="row-actions social-challenge-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void createChallenge()}>
                Create challenge
              </button>
            </div>
          </div>
          <h3 className="social-h3 social-challenge-list-heading">Open challenges</h3>
          <ul className="social-list social-challenge-list">
            {challenges.map((c) => {
              const r = asRecord(c);
              const id = Number(r.id);
              const setId = Number(r.beatmapset_id);
              const dl = Number(r.deadline);
              const deadlineLabel = Number.isFinite(dl) ? new Date(dl).toLocaleString() : String(r.deadline ?? "—");
              const disp = parseChallengeRulesDisplay(r);
              const mapLine = disp ? `${disp.artist} — ${disp.title}` : `Set #${String(r.beatmapset_id ?? "—")}`;
              const iAmIn = Boolean(r.i_am_in);
              const participantCount = Number(r.participant_count);
              const pcLabel = Number.isFinite(participantCount) ? participantCount : 0;
              const standingsRaw = r.standings_top;
              const standingsTop = Array.isArray(standingsRaw) ? standingsRaw : [];
              const windowOpen = Number.isFinite(dl) && Date.now() < dl;
              const canSubmit = iAmIn && windowOpen;

              return (
                <li key={id} className="social-challenge-row">
                  <div className="social-challenge-main">
                    <span className="social-challenge-title">{mapLine}</span>
                    <span className="hint social-challenge-meta">
                      Challenge #{id} · {pcLabel} participant{pcLabel === 1 ? "" : "s"} · ends {deadlineLabel}
                    </span>
                    {standingsTop.length > 0 && (
                      <ul className="social-challenge-standings" aria-label="Top scores">
                        {standingsTop.map((row) => {
                          const sr = asRecord(row);
                          const uid = Number(sr.user_osu_id);
                          const sc = Number(sr.score);
                          return (
                            <li key={uid}>
                              {displayNameForOsu(uid)} — {Number.isFinite(sc) ? sc.toLocaleString() : "—"}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className="social-challenge-actions">
                    {!iAmIn ? (
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={busy || !windowOpen}
                        onClick={() => void joinChallenge(id)}
                      >
                        Join
                      </button>
                    ) : (
                      <button type="button" className="secondary small-btn" disabled>
                        Joined
                      </button>
                    )}
                    {canSubmit && meId != null && (
                      <button
                        type="button"
                        className="primary small-btn"
                        disabled={busy}
                        onClick={() => void submitChallengeFromOsu(id, setId)}
                      >
                        Submit from osu!
                      </button>
                    )}
                    {canSubmit && (
                      <button
                        type="button"
                        className="secondary small-btn"
                        disabled={busy}
                        onClick={() => void submitChallengeManual(id)}
                      >
                        Enter score…
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
            {challenges.length === 0 && (
              <li className="hint social-list-empty">No challenges yet.</li>
            )}
          </ul>
        </div>
      )}

      {sub === "leaderboard" && (
        <SocialLeaderboard
          meId={selfOsuId}
          participants={leaderboardParticipants}
          refreshSignal={leaderboardSignal}
          onToast={onToast}
        />
      )}
    </div>
  );
}
