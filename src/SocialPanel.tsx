import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  baselinePpPerStarFromBestScores,
  beatmapStars,
  pickBestChallengePlay,
  playBeatmapIdFromScore,
  scoreBeatmapsetId,
} from "./challengeScoring";
import { notifyDesktop } from "./desktopNotify";
import { BattlesPanel } from "./BattlesPanel";
import { normalizeAccuracy } from "./trainBaseline";
import { FriendProfileModal } from "./FriendProfileModal";
import { NeuSelect, type NeuSelectOption } from "./NeuSelect";
import { fetchOsuPerformanceRankForUser } from "./osuPlayerRankFetch";
import type { PlayerRankInfo } from "./playerRank";
import { SocialLeaderboard } from "./SocialLeaderboard";
import { useStickyStuck } from "./MainPaneSticky";

type SocialSub = "friends" | "activity" | "battles" | "challenges" | "leaderboard";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
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

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type LivePlayRow = {
  key: string;
  osuId: number;
  username: string;
  artist: string;
  title: string;
  version: string;
  pp: number | null;
  accuracyPct: number | null;
  rank: string;
  stars: number | null;
  atMs: number;
  beatmapId: number | null;
  beatmapsetId: number | null;
};

function extractScoreArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const o = asRecord(raw);
  if (Array.isArray(o.scores)) return o.scores;
  return [];
}

function scoreAtMs(s: Record<string, unknown>): number | null {
  const atRaw = s.created_at ?? s.ended_at;
  if (typeof atRaw === "string") {
    const t = Date.parse(atRaw);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof atRaw === "number" && Number.isFinite(atRaw)) {
    return atRaw > 1e12 ? atRaw : atRaw * 1000;
  }
  return null;
}

function parseRecentScoresForFeed(raw: unknown, osuId: number, username: string): LivePlayRow[] {
  const list = extractScoreArray(raw);
  const out: LivePlayRow[] = [];
  for (const item of list) {
    const s = asRecord(item);
    const atMs = scoreAtMs(s);
    if (atMs == null) continue;
    const bm = asRecord(s.beatmap ?? {});
    const bs = asRecord(s.beatmapset ?? {});
    const artist = String(bs.artist ?? bs.artist_unicode ?? "").trim();
    const title = String(bs.title ?? bs.title_unicode ?? "").trim();
    const version = String(bm.version ?? "").trim() || "—";
    const sid = num(s.id);
    const bmid = playBeatmapIdFromScore(s);
    const bsetId = scoreBeatmapsetId(s);
    const key = sid != null ? `score-${sid}` : `${osuId}-${bmid ?? "x"}-${atMs}`;
    out.push({
      key,
      osuId,
      username,
      artist: artist || "—",
      title: title || "—",
      version,
      pp: num(s.pp),
      accuracyPct: normalizeAccuracy(s.accuracy),
      rank: String(s.rank ?? s.grade ?? "").trim() || "—",
      stars: beatmapStars(s),
      atMs,
      beatmapId: bmid,
      beatmapsetId: bsetId,
    });
  }
  return out;
}

function dedupeLiveRows(rows: LivePlayRow[]): LivePlayRow[] {
  const seen = new Set<string>();
  const out: LivePlayRow[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}

function formatRelativePlayTime(atMs: number): string {
  const d = Date.now() - atMs;
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
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

/** osu! website /friends list → ids + usernames for the live feed */
function osuWebFriendsForFeed(raw: unknown): Array<{ osuId: number; username: string }> {
  const list = extractOsuFriendsList(raw);
  const out: Array<{ osuId: number; username: string }> = [];
  for (const u of list) {
    const r = asRecord(u);
    const target = asRecord(r.target ?? r);
    const id = Number(target.id ?? r.id);
    if (!Number.isFinite(id)) continue;
    const name = String(target.username ?? r.username ?? "—").trim() || `User ${id}`;
    out.push({ osuId: id, username: name });
  }
  return out;
}

function FriendRankBadge({
  osuId,
  ranks,
}: {
  osuId: number;
  ranks: Map<number, PlayerRankInfo>;
}) {
  const r = ranks.get(osuId);
  if (!r) return null;
  const title = r.isEmpty
    ? "No performance stats"
    : `Performance ${r.compositeScore.toFixed(1)}/100 — ${r.name}`;
  return (
    <span className={`social-friend-rank social-friend-rank--${r.rankId}`} title={title}>
      {r.name}
    </span>
  );
}

export function SocialPanel({
  onToast,
  resolvedSocialApiBaseUrl,
  socialApiIsOverride,
}: {
  onToast: (tone: "info" | "success" | "error", message: string) => void;
  resolvedSocialApiBaseUrl: string | null;
  socialApiIsOverride: boolean;
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
  const [livePlays, setLivePlays] = useState<LivePlayRow[]>([]);
  const [liveFeedErr, setLiveFeedErr] = useState<string | null>(null);

  const [challenges, setChallenges] = useState<unknown[]>([]);
  const [challengeMapQuery, setChallengeMapQuery] = useState("");
  const [challengeMapResults, setChallengeMapResults] = useState<Array<{ id: number; title: string; artist: string }>>([]);
  const [challengeMapSearching, setChallengeMapSearching] = useState(false);
  const [challengePick, setChallengePick] = useState<{ id: number; title: string; artist: string } | null>(null);
  const [challengeSelectValue, setChallengeSelectValue] = useState("");
  const [chDeadlinePreset, setChDeadlinePreset] = useState("");
  const [chDeadlineCustom, setChDeadlineCustom] = useState("");
  const [challengeDiffOptions, setChallengeDiffOptions] = useState<NeuSelectOption[]>([
    { value: "", label: "Any difficulty" },
  ]);
  const [challengeDiffValue, setChallengeDiffValue] = useState("");

  const [leaderboardSignal, setLeaderboardSignal] = useState(0);
  const [battleRefreshSignal, setBattleRefreshSignal] = useState(0);
  const [profileFriend, setProfileFriend] = useState<{ osuId: number; username: string } | null>(null);
  /** Performance ranks for friend osu! ids (server + osu web lists). */
  const [peerRanksByOsuId, setPeerRanksByOsuId] = useState<Map<number, PlayerRankInfo>>(new Map());
  /** After first {@link runRefresh} completes so friend-request notifications skip the initial snapshot. */
  const [socialFriendsLoadDone, setSocialFriendsLoadDone] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const challengePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const friendNotifySeenIdsRef = useRef<Set<number>>(new Set());
  const friendNotifyBootstrappedRef = useRef(false);
  const prevSocialApiBaseUrlRef = useRef<string | null | undefined>(undefined);
  const { sentinelRef, stuck } = useStickyStuck();

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

  const refreshLiveFeed = useCallback(async () => {
    setLiveFeedErr(null);
    const myId = meId ?? oauthOsuId;
    const accepted = localFriends.filter((f) => isAcceptedFriendStatus(f.status));
    const participants: Array<{ osuId: number; username: string }> = [];
    const seen = new Set<number>();
    const max = 15;
    if (myId != null) {
      seen.add(myId);
      participants.push({ osuId: myId, username: "You" });
    }
    for (const f of accepted) {
      if (participants.length >= max) break;
      if (seen.has(f.osuId)) continue;
      seen.add(f.osuId);
      participants.push({
        osuId: f.osuId,
        username: f.username?.trim() ? f.username : `User ${f.osuId}`,
      });
    }
    for (const w of osuWebFriendsForFeed(osuFriendsRaw)) {
      if (participants.length >= max) break;
      if (seen.has(w.osuId)) continue;
      seen.add(w.osuId);
      participants.push({ osuId: w.osuId, username: w.username });
    }
    if (participants.length === 0) {
      setLivePlays([]);
      setLiveFeedErr(
        "Sign in with osu!, add server friends or osu! website friends (friends.read), then use Refresh.",
      );
      return;
    }
    try {
      const results = await Promise.all(
        participants.map(async (p) => {
          try {
            const raw = await invoke<unknown>("osu_user_recent_scores", {
              userId: p.osuId,
              limit: 6,
              mode: "osu",
            });
            return { ok: true as const, p, raw };
          } catch (e) {
            return { ok: false as const, p, err: String(e) };
          }
        }),
      );
      const rows: LivePlayRow[] = [];
      let failCount = 0;
      for (const r of results) {
        if (!r.ok) {
          failCount += 1;
          continue;
        }
        rows.push(...parseRecentScoresForFeed(r.raw, r.p.osuId, r.p.username));
      }
      const deduped = dedupeLiveRows(rows);
      deduped.sort((a, b) => b.atMs - a.atMs);
      setLivePlays(deduped.slice(0, 40));
      if (failCount > 0) {
        if (deduped.length === 0) {
          setLiveFeedErr(
            failCount === participants.length
              ? "Could not load recent scores. Sign in with osu! and check your connection."
              : "Some players could not be loaded.",
          );
        } else {
          setLiveFeedErr("Some players could not be loaded.");
        }
      }
    } catch (e) {
      setLiveFeedErr(String(e));
      setLivePlays([]);
    }
  }, [meId, oauthOsuId, localFriends, osuFriendsRaw]);

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
      if (sub === "activity") {
        await refreshActivity();
        await refreshLiveFeed();
      }
      if (sub === "challenges") await refreshChallenges();
      if (sub === "leaderboard") setLeaderboardSignal((s) => s + 1);
    } catch (e) {
      const msg = String(e);
      setErr(msg);
      onToast("error", msg);
    } finally {
      setBusy(false);
      setSocialFriendsLoadDone(true);
      setBattleRefreshSignal((s) => s + 1);
    }
  }, [
    refreshMe,
    refreshOauthOsuId,
    refreshLocalFriends,
    loadOsuFriends,
    refreshActivity,
    refreshLiveFeed,
    refreshChallenges,
    sub,
    onToast,
  ]);

  useEffect(() => {
    void runRefresh();
  }, []);

  useEffect(() => {
    if (prevSocialApiBaseUrlRef.current === undefined) {
      prevSocialApiBaseUrlRef.current = resolvedSocialApiBaseUrl;
      return;
    }
    if (prevSocialApiBaseUrlRef.current === resolvedSocialApiBaseUrl) return;
    prevSocialApiBaseUrlRef.current = resolvedSocialApiBaseUrl;
    friendNotifyBootstrappedRef.current = false;
    friendNotifySeenIdsRef.current = new Set();
    setSocialFriendsLoadDone(false);
    if (resolvedSocialApiBaseUrl) void runRefresh();
  }, [resolvedSocialApiBaseUrl, runRefresh]);

  useEffect(() => {
    if (!resolvedSocialApiBaseUrl) return;
    const id = window.setInterval(() => {
      void refreshLocalFriends().catch(() => {});
    }, 90_000);
    return () => window.clearInterval(id);
  }, [resolvedSocialApiBaseUrl, refreshLocalFriends]);

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
      void refreshLiveFeed().catch(() => {});
    }, 12_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sub, refreshActivity, refreshLiveFeed]);

  useEffect(() => {
    if (sub === "activity") {
      void loadOsuFriends().catch(() => {});
      void refreshActivity().catch(() => {});
    }
  }, [sub, refreshActivity, loadOsuFriends]);

  /** Re-merge live plays after osu! website friends load (async) or list changes. */
  useEffect(() => {
    if (sub !== "activity") return;
    void refreshLiveFeed().catch(() => {});
  }, [sub, osuFriendsRaw, refreshLiveFeed]);

  useEffect(() => {
    if (sub === "challenges") void refreshChallenges().catch(() => {});
  }, [sub, refreshChallenges]);

  useEffect(() => {
    if (sub !== "battles" && sub !== "leaderboard" && sub !== "challenges") return;
    void refreshLocalFriends().catch(() => {});
    void loadOsuFriends().catch(() => {});
  }, [sub, refreshLocalFriends, loadOsuFriends]);

  useEffect(() => {
    if (sub !== "challenges") {
      if (challengePollRef.current) {
        clearInterval(challengePollRef.current);
        challengePollRef.current = null;
      }
      return;
    }
    challengePollRef.current = setInterval(() => {
      void refreshChallenges().catch(() => {});
    }, 15_000);
    return () => {
      if (challengePollRef.current) clearInterval(challengePollRef.current);
    };
  }, [sub, refreshChallenges]);

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

  useEffect(() => {
    if (!challengePick) {
      setChallengeDiffOptions([{ value: "", label: "Any difficulty" }]);
      setChallengeDiffValue("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<unknown>("get_beatmapset", { beatmapsetId: challengePick.id });
        const root = asRecord(raw);
        const bms = root.beatmaps;
        const opts: NeuSelectOption[] = [{ value: "", label: "Any difficulty (relative PP)" }];
        if (Array.isArray(bms)) {
          for (const x of bms) {
            const bm = asRecord(x);
            if (String(bm.mode ?? "") !== "osu") continue;
            const st = String(bm.status ?? "").toLowerCase();
            if (st && st !== "ranked") continue;
            const id = Number(bm.id);
            const stars = Number(bm.difficulty_rating);
            const ver = String(bm.version ?? "Beatmap").trim() || "Beatmap";
            if (!Number.isFinite(id)) continue;
            opts.push({
              value: String(id),
              label: Number.isFinite(stars) ? `${ver} (${stars.toFixed(1)}★)` : ver,
            });
          }
        }
        if (!cancelled) {
          setChallengeDiffOptions(opts);
          setChallengeDiffValue("");
        }
      } catch {
        if (!cancelled) {
          setChallengeDiffOptions([{ value: "", label: "Any difficulty" }]);
          setChallengeDiffValue("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [challengePick]);

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
      const body: Record<string, unknown> = {
        beatmapsetId: challengePick.id,
        deadlineMs,
        rulesJson: {
          display: { title: challengePick.title, artist: challengePick.artist },
        },
      };
      if (challengeDiffValue.trim()) {
        const bid = Number(challengeDiffValue);
        if (Number.isFinite(bid)) body.beatmapId = bid;
      }
      await socialPost("/api/v1/challenges", body);
      onToast("success", "Challenge created.");
      setChallengeMapQuery("");
      setChallengeMapResults([]);
      setChallengePick(null);
      setChallengeSelectValue("");
      setChDeadlinePreset("");
      setChDeadlineCustom("");
      setChallengeDiffValue("");
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

  const submitChallengeFromOsu = async (
    challengeId: number,
    beatmapsetId: number,
    fixedBeatmapId: number | null,
  ) => {
    if (meId == null) {
      onToast("error", "Sign in with osu! so we can read your recent scores.");
      return;
    }
    setBusy(true);
    try {
      const bestRaw = await invoke<unknown>("osu_user_best_scores", {
        userId: meId,
        limit: 100,
        mode: "osu",
      });
      const baseline = baselinePpPerStarFromBestScores(bestRaw);
      const recentRaw = await invoke<unknown>("osu_user_recent_scores", { userId: meId, limit: 100, mode: "osu" });
      const picked = pickBestChallengePlay(recentRaw, beatmapsetId, {
        fixedBeatmapId,
        baselinePpPerStar: baseline,
      });
      if (picked == null) {
        onToast(
          "error",
          "No recent ranked score on this challenge (need PP on the map). Play in osu! (stable), then try again.",
        );
        return;
      }
      await socialPost(`/api/v1/challenges/${challengeId}/submit`, {
        score: picked.score,
        mods: 0,
        rankValue: picked.rankValue,
        pp: picked.pp,
        stars: picked.stars,
        playBeatmapId: picked.playBeatmapId,
        baselinePpPerStar: picked.baselinePpPerStar,
        isUnweighted: false,
      });
      onToast(
        "success",
        `Submitted ${picked.pp.toFixed(0)}pp (${picked.rankValue.toFixed(2)}× vs your baseline) from osu! recent scores.`,
      );
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitChallengeManual = async (id: number) => {
    const raw = window.prompt(
      "Enter your game score (honor system). Manual entries are unweighted raw score and rank below PP-weighted osu! submits.",
    );
    if (raw == null) return;
    const score = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(score)) return;
    setBusy(true);
    try {
      await socialPost(`/api/v1/challenges/${id}/submit`, { score, mods: 0, isUnweighted: true });
      onToast("success", "Raw score submitted (unweighted).");
      await refreshChallenges();
    } catch (e) {
      onToast("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const acceptedFriends = localFriends.filter((f) => isAcceptedFriendStatus(f.status));

  const peerRankFetchKey = useMemo(() => {
    const ids = new Set<number>();
    for (const f of localFriends) {
      if (Number.isFinite(f.osuId) && f.osuId > 0) ids.add(f.osuId);
    }
    for (const row of osuWebFriendRows(osuFriendsRaw)) {
      if (Number.isFinite(row.osuId) && row.osuId > 0) ids.add(row.osuId);
    }
    return [...ids].sort((a, b) => a - b).join(",");
  }, [localFriends, osuFriendsRaw]);

  useEffect(() => {
    if (!isTauri()) return;
    const ids = peerRankFetchKey
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) {
      setPeerRanksByOsuId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (osuId) => {
          try {
            return [osuId, await fetchOsuPerformanceRankForUser(osuId)] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const m = new Map<number, PlayerRankInfo>();
      for (const e of entries) {
        if (e) m.set(e[0], e[1]);
      }
      setPeerRanksByOsuId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [peerRankFetchKey]);

  /** Party-server id when linked; otherwise osu! OAuth `/me` so the leaderboard always includes you when signed in. */
  const selfOsuId = useMemo(() => meId ?? oauthOsuId, [meId, oauthOsuId]);

  useEffect(() => {
    if (!resolvedSocialApiBaseUrl || selfOsuId == null || !socialFriendsLoadDone) return;
    const incoming = localFriends.filter((f) => f.status === "pending" && f.requestedBy !== selfOsuId);
    if (!friendNotifyBootstrappedRef.current) {
      for (const f of incoming) {
        friendNotifySeenIdsRef.current.add(f.friendshipId);
      }
      friendNotifyBootstrappedRef.current = true;
      return;
    }
    for (const f of incoming) {
      if (!friendNotifySeenIdsRef.current.has(f.friendshipId)) {
        friendNotifySeenIdsRef.current.add(f.friendshipId);
        const label = f.username?.trim() ? f.username : `User ${f.osuId}`;
        void notifyDesktop("osu-link — Friend request", `${label} wants to connect`);
      }
    }
  }, [localFriends, selfOsuId, resolvedSocialApiBaseUrl, socialFriendsLoadDone]);

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

  const socialApiHostLabel = useMemo(() => {
    const u = resolvedSocialApiBaseUrl?.trim();
    if (!u) return null;
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  }, [resolvedSocialApiBaseUrl]);

  return (
    <div className="panel panel-elevated">
      <div className="panel-head">
        <h2>Social</h2>
        <p className="panel-sub">
          Needs the social server; osu! web friends require <code className="inline-code">friends.read</code> in OAuth.
        </p>
      </div>

      <div className="social-api-status-compact">
        <span
          className={`social-api-dot ${resolvedSocialApiBaseUrl ? "social-api-dot--on" : "social-api-dot--off"}`}
          title={resolvedSocialApiBaseUrl ? "API base URL set" : "No API URL"}
          aria-hidden
        />
        <span className="social-api-status-text">
          <strong className="social-api-status-label">API</strong>{" "}
          {socialApiHostLabel ?? (
            <span className="social-api-status-missing">Not configured</span>
          )}
          {socialApiHostLabel ? (
            <span className="social-api-status-source">
              {" "}
              · {socialApiIsOverride ? "Settings override" : "from party URL"}
            </span>
          ) : null}
        </span>
        <details className="social-api-details">
          <summary>Details</summary>
          <div className="party-server-status party-server-status--nested">
            <dl className="party-server-status-grid">
              <dt>API base</dt>
              <dd>{resolvedSocialApiBaseUrl ?? "—"}</dd>
              <dt>Source</dt>
              <dd>{socialApiIsOverride ? "Settings override" : "Derived from party WebSocket URL"}</dd>
            </dl>
            <p className="hint party-status-meta social-api-settings-hint">
              Override URL in <strong>Settings</strong> if needed.
            </p>
          </div>
        </details>
      </div>

      {err && <div className="error-banner">{err}</div>}

      <div className="social-panel-body" aria-busy={busy ? true : undefined}>
      <div ref={sentinelRef} className="main-pane-sticky-sentinel" aria-hidden />
      <div
        className={`social-tab-bar${stuck ? " social-tab-bar--stuck" : ""}`}
        role="tablist"
        aria-label="Social sections"
      >
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
            {localFriends.length > 0 ? (
              <ul className="social-list social-friend-list">
                {localFriends.map((f) => (
                  <li key={f.friendshipId} className="social-friend-row">
                    <div className="social-friend-meta">
                      <span className="social-friend-name-line">
                        <span className="social-friend-name">{f.username}</span>
                        <FriendRankBadge osuId={f.osuId} ranks={peerRanksByOsuId} />
                      </span>
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
                        <>
                          <button
                            type="button"
                            className="secondary small-btn"
                            onClick={() => setProfileFriend({ osuId: f.osuId, username: f.username })}
                          >
                            Profile
                          </button>
                          <button type="button" className="danger small-btn" onClick={() => void removeFriend(f.osuId)}>
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="social-card social-empty-card">
                <p className="hint social-empty-card-text">No server friendships yet. Send a request above, or wait for one to arrive.</p>
              </div>
            )}
          </div>

          <div className="social-subsection">
            <h3 className="social-h3">osu! website friends</h3>
            <p className="hint social-subsection-hint">Requires OAuth re-login with friends.read.</p>
            {osuFriendsErr && <div className="error-banner">{osuFriendsErr}</div>}
            {osuFriendsList.length > 0 ? (
              <ul className="social-list social-friend-list social-osu-web-list">
                {osuFriendsList.map((u: unknown, i: number) => {
                  const r = asRecord(u);
                  const target = asRecord(r.target ?? r);
                  const id = Number(target.id ?? r.id);
                  const name = String(target.username ?? r.username ?? "—");
                  return (
                    <li key={typeof id === "number" && !Number.isNaN(id) ? id : i} className="social-friend-row social-osu-web-row">
                      <span className="social-friend-name-line">
                        <span className="social-friend-name">{name}</span>
                        {Number.isFinite(id) ? <FriendRankBadge osuId={id} ranks={peerRanksByOsuId} /> : null}
                      </span>
                      {Number.isFinite(id) ? <span className="social-friend-id">{id}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="social-card social-empty-card">
                <p className="hint social-empty-card-text">None loaded. Re-sign in with osu! if you need website friends here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {sub === "activity" && (
        <div className="social-section social-activity-section">
          <div className="social-subsection">
            <h3 className="social-h3">Live plays</h3>
            <p className="hint social-activity-intro">
              Recent osu! scores from you, osu-link friends, and osu! website friends (needs{" "}
              <code className="inline-code">friends.read</code>; same refresh as below, ~12s).
            </p>
            {liveFeedErr && <div className="error-banner">{liveFeedErr}</div>}
            {livePlays.length > 0 ? (
              <ul className="social-list social-live-plays-list">
                {livePlays.map((row) => {
                  const mapHref =
                    row.beatmapsetId != null && row.beatmapId != null
                      ? `https://osu.ppy.sh/beatmapsets/${row.beatmapsetId}#osu/${row.beatmapId}`
                      : row.beatmapsetId != null
                        ? `https://osu.ppy.sh/beatmapsets/${row.beatmapsetId}`
                        : null;
                  const acc =
                    row.accuracyPct != null && Number.isFinite(row.accuracyPct)
                      ? `${row.accuracyPct.toFixed(2)}%`
                      : null;
                  return (
                    <li key={row.key} className="social-live-play-row">
                      <div className="social-live-play-head">
                        <span className="social-live-play-user">{row.username}</span>
                        <time
                          className="social-live-play-time"
                          dateTime={new Date(row.atMs).toISOString()}
                          title={new Date(row.atMs).toLocaleString()}
                        >
                          {formatRelativePlayTime(row.atMs)}
                        </time>
                      </div>
                      <div className="social-live-play-map">
                        {mapHref ? (
                          <a href={mapHref} target="_blank" rel="noreferrer" className="social-live-play-title-link">
                            <span className="social-live-play-artist-title">
                              {row.artist} — {row.title}
                            </span>
                          </a>
                        ) : (
                          <span className="social-live-play-artist-title">
                            {row.artist} — {row.title}
                          </span>
                        )}
                        <span className="social-live-play-version">{row.version}</span>
                      </div>
                      <div className="social-live-play-meta">
                        {row.pp != null && row.pp > 0 ? (
                          <span className="social-live-play-pp">{row.pp.toFixed(0)}pp</span>
                        ) : null}
                        {row.stars != null && row.stars > 0 ? (
                          <span className="social-live-play-stars">{row.stars.toFixed(1)}★</span>
                        ) : null}
                        <span className="social-live-play-rank">{row.rank}</span>
                        {acc ? <span className="social-live-play-acc">{acc}</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : !liveFeedErr ? (
              <div className="social-card social-empty-card">
                <p className="hint social-empty-card-text">
                  No recent scores loaded. Sign in with osu!, add server or website friends, and try Refresh.
                </p>
              </div>
            ) : null}
          </div>

          <div className="social-subsection">
            <h3 className="social-h3">Server activity</h3>
            {activityLoadErr && <div className="error-banner">{activityLoadErr}</div>}
            <p className="hint social-activity-intro">
              Latest actions from your social server (updates every ~12s while this tab is open).
            </p>
            {activityEvents.length > 0 ? (
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
              </ul>
            ) : (
              <div className="social-card social-empty-card">
                <p className="hint social-empty-card-text">
                  No visible events yet. Activity will show here as friends interact on the server.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {sub === "battles" && (
        <BattlesPanel
          onToast={onToast}
          socialGet={socialGet}
          socialPost={socialPost}
          meId={meId}
          oauthOsuId={oauthOsuId}
          displayNameForOsu={displayNameForOsu}
          friendSelectOptions={friendSelectOptions}
          resolvedSocialApiBaseUrl={resolvedSocialApiBaseUrl}
          refreshSignal={battleRefreshSignal}
        />
      )}

      {sub === "challenges" && (
        <div className="social-section social-challenge-section social-challenge-view">
          <div className="social-subview-head">
            <p className="panel-sub panel-sub--tight social-challenge-lede">
              Relative PP ranking vs your own PP/★ curve. Optional fixed difficulty. Manual scores are raw and sort below
              weighted submits. Refreshes every ~15s while open.
            </p>
          </div>
          <div className="social-compose-shell">
            <div className="battle-map-panel">
              <div className="battle-map-panel-header">
                <span className="battle-map-panel-title">Map</span>
                <span className="battle-map-panel-sub">Ranked beatmaps · search, then pick from the list</span>
              </div>
              <label className="field battle-map-search-field">
                <span>Search</span>
                <input
                  type="search"
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
              {challengePick && (
                <label className="field">
                  <span>Difficulty</span>
                  <NeuSelect
                    value={challengeDiffValue}
                    disabled={busy}
                    options={challengeDiffOptions}
                    onChange={(v) => setChallengeDiffValue(v)}
                  />
                </label>
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
            <div className="row-actions row-actions--spaced social-challenge-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void createChallenge()}>
                Create challenge
              </button>
            </div>
          </div>
          <section className="social-list-section social-challenge-list-section" aria-labelledby="challenges-open-heading">
            <h3 id="challenges-open-heading" className="social-list-section__title">
              Open challenges
            </h3>
            <ul className="social-list social-challenge-list">
            {challenges.map((c) => {
              const r = asRecord(c);
              const id = Number(r.id);
              const setId = Number(r.beatmapset_id);
              const dl = Number(r.deadline);
              const deadlineLabel = Number.isFinite(dl) ? new Date(dl).toLocaleString() : String(r.deadline ?? "—");
              const disp = parseChallengeRulesDisplay(r);
              const mapLine = disp ? `${disp.artist} — ${disp.title}` : `Set #${String(r.beatmapset_id ?? "—")}`;
              const chBm = Number(r.beatmap_id);
              const fixedDiff = Number.isFinite(chBm) ? chBm : null;
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
                      {fixedDiff != null ? ` · fixed beatmap ${fixedDiff}` : ""}
                    </span>
                    {standingsTop.length > 0 && (
                      <ul className="social-challenge-standings" aria-label="Top scores">
                        {standingsTop.map((row) => {
                          const sr = asRecord(row);
                          const uid = Number(sr.user_osu_id);
                          const sc = Number(sr.score);
                          const rv = sr.rank_value != null ? Number(sr.rank_value) : null;
                          const ppV = sr.pp != null ? Number(sr.pp) : null;
                          const starsV = sr.stars != null ? Number(sr.stars) : null;
                          const unweighted = Boolean(sr.is_unweighted);
                          let line: string;
                          if (unweighted) {
                            line = `${displayNameForOsu(uid)} — ${Number.isFinite(sc) ? sc.toLocaleString() : "—"} (raw)`;
                          } else if (rv != null && Number.isFinite(rv)) {
                            const starBit =
                              starsV != null && Number.isFinite(starsV) ? `★${starsV.toFixed(1)} · ` : "";
                            const ppBit = ppV != null && Number.isFinite(ppV) ? `${ppV.toFixed(0)}pp · ` : "";
                            line = `${displayNameForOsu(uid)} — ${starBit}${ppBit}${rv.toFixed(2)}×`;
                          } else {
                            line = `${displayNameForOsu(uid)} — ${Number.isFinite(sc) ? sc.toLocaleString() : "—"}`;
                          }
                          return (
                            <li key={uid}>
                              {line}
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
                        onClick={() => void submitChallengeFromOsu(id, setId, fixedDiff)}
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
          </section>
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

      {profileFriend ? (
        <FriendProfileModal
          open
          onClose={() => setProfileFriend(null)}
          osuId={profileFriend.osuId}
          username={profileFriend.username}
          socialGet={socialGet}
        />
      ) : null}
      </div>
    </div>
  );
}
