/**
 * REST API /api/v1 for osu-link social layer.
 */
import { validateBearer } from "./auth.mjs";

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function pair(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? [x, y] : [y, x];
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function upsertUser(db, u) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (osu_id, username, avatar_url, updated_at)
     VALUES (@osuId, @username, @avatarUrl, @now)
     ON CONFLICT(osu_id) DO UPDATE SET
       username = excluded.username,
       avatar_url = excluded.avatar_url,
       updated_at = excluded.updated_at`,
  ).run({
    osuId: u.osuId,
    username: u.username,
    avatarUrl: u.avatarUrl,
    now,
  });
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} osuId
 */
function friendOsuIds(db, osuId) {
  const rows = db
    .prepare(
      `SELECT user_low, user_high, status FROM friendships
       WHERE (user_low = ? OR user_high = ?) AND status = 'accepted'`,
    )
    .all(osuId, osuId);
  const out = new Set();
  for (const r of rows) {
    const other = r.user_low === osuId ? r.user_high : r.user_low;
    out.add(other);
  }
  return out;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} method
 * @param {string} pathname
 */
export async function handleSocialApi(db, req, res, method, pathname) {
  const auth = req.headers.authorization;
  const bearer =
    typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
  const v = await validateBearer(bearer);
  if (!v.ok) {
    return json(res, v.status === 401 ? 401 : 403, { error: "invalid_token", detail: v.body });
  }
  upsertUser(db, v.user);
  const me = v.user.osuId;

  try {
    if (method === "GET" && pathname === "/api/v1/me") {
      const row = db.prepare(`SELECT osu_id, username, avatar_url, updated_at FROM users WHERE osu_id = ?`).get(me);
      return json(res, 200, { user: row });
    }

    if (method === "GET" && pathname === "/api/v1/friends") {
      const rows = db
        .prepare(
          `SELECT f.id, f.user_low, f.user_high, f.status, f.requested_by, f.created_at,
                  u1.username AS u1name, u2.username AS u2name
           FROM friendships f
           LEFT JOIN users u1 ON u1.osu_id = f.user_low
           LEFT JOIN users u2 ON u2.osu_id = f.user_high
           WHERE f.user_low = ? OR f.user_high = ?`,
        )
        .all(me, me);
      const friends = rows.map((r) => {
        const other = r.user_low === me ? r.user_high : r.user_low;
        const otherName = r.user_low === me ? r.u2name : r.u1name;
        return {
          friendshipId: r.id,
          osuId: other,
          username: otherName || String(other),
          status: r.status,
          requestedBy: r.requested_by,
          createdAt: r.created_at,
        };
      });
      return json(res, 200, { friends });
    }

    if (method === "POST" && pathname === "/api/v1/friends/request") {
      const body = await readBody(req);
      const target = Number(body?.targetOsuId);
      if (!Number.isFinite(target) || target === me) {
        return json(res, 400, { error: "bad_request", message: "targetOsuId required" });
      }
      upsertUser(db, { osuId: target, username: String(target), avatarUrl: null });
      const [low, high] = pair(me, target);
      const existing = db.prepare(`SELECT id, status FROM friendships WHERE user_low = ? AND user_high = ?`).get(low, high);
      if (existing) {
        return json(res, 409, { error: "exists", friendshipId: existing.id, status: existing.status });
      }
      const info = db
        .prepare(
          `INSERT INTO friendships (user_low, user_high, status, requested_by, created_at)
           VALUES (?, ?, 'pending', ?, ?)`,
        )
        .run(low, high, me, Date.now());
      insertActivity(db, me, "friend_request", { targetOsuId: target, friendshipId: info.lastInsertRowid });
      return json(res, 201, { friendshipId: info.lastInsertRowid });
    }

    if (method === "POST" && pathname === "/api/v1/friends/accept") {
      const body = await readBody(req);
      const fid = Number(body?.friendshipId);
      let row = null;
      if (Number.isFinite(fid)) {
        row = db.prepare(`SELECT * FROM friendships WHERE id = ?`).get(fid);
      }
      if (!row && body?.targetOsuId != null) {
        const [low, high] = pair(me, Number(body.targetOsuId));
        row = db.prepare(`SELECT * FROM friendships WHERE user_low = ? AND user_high = ?`).get(low, high);
      }
      if (!row) return json(res, 404, { error: "not_found" });
      if (row.status !== "pending") return json(res, 400, { error: "not_pending" });
      if (row.requested_by === me) return json(res, 400, { error: "cannot_accept_own_request" });
      if (row.user_low !== me && row.user_high !== me) {
        return json(res, 403, { error: "forbidden" });
      }
      db.prepare(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).run(row.id);
      insertActivity(db, me, "friend_accepted", { otherOsuId: row.requested_by });
      return json(res, 200, { ok: true, friendshipId: row.id });
    }

    if (method === "DELETE" && pathname.startsWith("/api/v1/friends/")) {
      const other = Number(pathname.replace("/api/v1/friends/", ""));
      if (!Number.isFinite(other)) return json(res, 400, { error: "bad_request" });
      const [low, high] = pair(me, other);
      const r = db.prepare(`DELETE FROM friendships WHERE user_low = ? AND user_high = ?`).run(low, high);
      if (r.changes === 0) return json(res, 404, { error: "not_found" });
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && pathname === "/api/v1/activity") {
      const u = new URL(req.url || "/", "http://localhost");
      const cursor = Number(u.searchParams.get("cursor"));
      const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit")) || 40));
      const friends = friendOsuIds(db, me);
      friends.add(me);
      const ids = [...friends];
      const placeholders = ids.map(() => "?").join(",");
      /** Include rows where the viewer is named in the payload or is party to a battle/challenge, not only when the actor is an accepted friend. */
      let sql = `SELECT id, actor_osu_id, type, payload, created_at FROM activity_events
        WHERE (
          actor_osu_id IN (${placeholders})
          OR json_extract(payload, '$.opponentOsuId') = ?
          OR json_extract(payload, '$.targetOsuId') = ?
          OR (
            json_extract(payload, '$.battleId') IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM async_battles b
              WHERE b.id = json_extract(payload, '$.battleId')
              AND (b.creator_osu_id = ? OR b.opponent_osu_id = ?)
            )
          )
          OR (
            json_extract(payload, '$.challengeId') IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM challenge_participants cp
              WHERE cp.challenge_id = json_extract(payload, '$.challengeId')
              AND cp.user_osu_id = ?
            )
          )
        )`;
      const params = [...ids, me, me, me, me, me];
      if (Number.isFinite(cursor) && cursor > 0) {
        sql += ` AND id < ?`;
        params.push(cursor);
      }
      sql += ` ORDER BY id DESC LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;
      return json(res, 200, { events: rows, nextCursor });
    }

    if (method === "POST" && pathname === "/api/v1/activity") {
      const body = await readBody(req);
      const type = typeof body?.type === "string" ? body.type : "";
      if (!type || type.length > 64) return json(res, 400, { error: "bad_request" });
      const payload = body?.payload != null ? JSON.stringify(body.payload) : null;
      insertActivity(db, me, type, payload ? JSON.parse(payload) : {});
      return json(res, 201, { ok: true });
    }

    if (method === "POST" && pathname === "/api/v1/challenges") {
      const body = await readBody(req);
      const beatmapsetId = Number(body?.beatmapsetId);
      const deadline = Number(body?.deadlineMs);
      if (!Number.isFinite(beatmapsetId) || !Number.isFinite(deadline)) {
        return json(res, 400, { error: "bad_request", message: "beatmapsetId and deadlineMs required" });
      }
      const now = Date.now();
      if (deadline <= now) {
        return json(res, 400, { error: "bad_request", message: "deadlineMs must be in the future" });
      }
      const beatmapId = body?.beatmapId != null ? Number(body.beatmapId) : null;
      const rulesJson = body?.rulesJson != null ? JSON.stringify(body.rulesJson) : null;
      const info = db
        .prepare(
          `INSERT INTO challenges (creator_osu_id, beatmapset_id, beatmap_id, rules_json, deadline, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        )
        .run(me, beatmapsetId, Number.isFinite(beatmapId) ? beatmapId : null, rulesJson, deadline, Date.now());
      const id = info.lastInsertRowid;
      db.prepare(`INSERT INTO challenge_participants (challenge_id, user_osu_id, joined_at) VALUES (?, ?, ?)`).run(
        id,
        me,
        Date.now(),
      );
      insertActivity(db, me, "challenge_created", { challengeId: id, beatmapsetId });
      return json(res, 201, { challengeId: id });
    }

    if (method === "GET" && pathname === "/api/v1/challenges") {
      const t = Date.now();
      const rows = db
        .prepare(
          `SELECT c.*,
            (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) AS participant_count,
            EXISTS(
              SELECT 1 FROM challenge_participants cp2
              WHERE cp2.challenge_id = c.id AND cp2.user_osu_id = ?
            ) AS i_am_in
           FROM challenges c
           WHERE c.status = 'open' AND c.deadline > ?
           ORDER BY c.created_at DESC LIMIT 100`,
        )
        .all(me, t);
      const ids = rows.map((r) => r.id);
      /** @type {Map<number, Array<{ user_osu_id: number; score: number }>>} */
      const standingsByChallenge = new Map();
      if (ids.length > 0) {
        const ph = ids.map(() => "?").join(",");
        const scoreRows = db
          .prepare(
            `SELECT challenge_id, user_osu_id, MAX(score) AS score
             FROM score_submissions
             WHERE challenge_id IN (${ph})
             GROUP BY challenge_id, user_osu_id`,
          )
          .all(...ids);
        for (const s of scoreRows) {
          const cid = s.challenge_id;
          let arr = standingsByChallenge.get(cid);
          if (!arr) {
            arr = [];
            standingsByChallenge.set(cid, arr);
          }
          arr.push({ user_osu_id: s.user_osu_id, score: s.score });
        }
        for (const arr of standingsByChallenge.values()) {
          arr.sort((a, b) => b.score - a.score);
          arr.splice(3);
        }
      }
      const out = rows.map((r) => ({
        ...r,
        i_am_in: Boolean(r.i_am_in),
        standings_top: standingsByChallenge.get(r.id) ?? [],
      }));
      return json(res, 200, { challenges: out });
    }

    if (method === "GET" && /^\/api\/v1\/challenges\/\d+\/standings$/.test(pathname)) {
      const id = Number(pathname.match(/\/challenges\/(\d+)\/standings/)?.[1]);
      const ch = db.prepare(`SELECT id FROM challenges WHERE id = ?`).get(id);
      if (!ch) return json(res, 404, { error: "not_found" });
      const scoreRows = db
        .prepare(
          `SELECT user_osu_id, MAX(score) AS score
           FROM score_submissions
           WHERE challenge_id = ?
           GROUP BY user_osu_id
           ORDER BY score DESC
           LIMIT 20`,
        )
        .all(id);
      return json(res, 200, { standings: scoreRows });
    }

    if (method === "POST" && /^\/api\/v1\/challenges\/\d+\/join$/.test(pathname)) {
      const id = Number(pathname.match(/\/challenges\/(\d+)\/join/)?.[1]);
      const ch = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(id);
      if (!ch) return json(res, 404, { error: "not_found" });
      if (ch.status !== "open" || ch.deadline <= Date.now()) return json(res, 400, { error: "closed" });
      try {
        db.prepare(`INSERT INTO challenge_participants (challenge_id, user_osu_id, joined_at) VALUES (?, ?, ?)`).run(
          id,
          me,
          Date.now(),
        );
      } catch {
        return json(res, 409, { error: "already_joined" });
      }
      insertActivity(db, me, "challenge_joined", { challengeId: id });
      return json(res, 200, { ok: true });
    }

    if (method === "POST" && /^\/api\/v1\/challenges\/\d+\/submit$/.test(pathname)) {
      const id = Number(pathname.match(/\/challenges\/(\d+)\/submit/)?.[1]);
      const body = await readBody(req);
      const score = Number(body?.score);
      const mods = Number(body?.mods ?? 0);
      if (!Number.isFinite(score)) return json(res, 400, { error: "bad_request" });
      const ch = db.prepare(`SELECT * FROM challenges WHERE id = ?`).get(id);
      if (!ch) return json(res, 404, { error: "not_found" });
      if (ch.status !== "open" || ch.deadline <= Date.now()) {
        return json(res, 400, { error: "closed" });
      }
      const part = db.prepare(`SELECT 1 FROM challenge_participants WHERE challenge_id = ? AND user_osu_id = ?`).get(id, me);
      if (!part) return json(res, 403, { error: "not_participant" });
      db.prepare(
        `INSERT INTO score_submissions (battle_id, challenge_id, user_osu_id, score, mods, submitted_at)
         VALUES (NULL, ?, ?, ?, ?, ?)`,
      ).run(id, me, Math.round(score), Math.round(mods), Date.now());
      insertActivity(db, me, "challenge_score", { challengeId: id, score: Math.round(score) });
      return json(res, 201, { ok: true });
    }

    if (method === "POST" && pathname === "/api/v1/battles") {
      const body = await readBody(req);
      const opponent = Number(body?.opponentOsuId);
      const beatmapsetId = Number(body?.beatmapsetId);
      if (!Number.isFinite(opponent) || !Number.isFinite(beatmapsetId)) {
        return json(res, 400, { error: "bad_request", message: "opponentOsuId and beatmapsetId required" });
      }
      if (opponent === me) return json(res, 400, { error: "bad_opponent" });
      const beatmapId = body?.beatmapId != null ? Number(body.beatmapId) : null;
      upsertUser(db, { osuId: opponent, username: String(opponent), avatarUrl: null });
      const now = Date.now();
      /** Default async battle window: 48h from creation if client omits or sends an invalid end time. */
      const DEFAULT_BATTLE_MS = 48 * 60 * 60 * 1000;
      let windowEnd = Number(body?.windowEndMs);
      if (!Number.isFinite(windowEnd) || windowEnd <= now) {
        windowEnd = now + DEFAULT_BATTLE_MS;
      }
      const info = db
        .prepare(
          `INSERT INTO async_battles (creator_osu_id, opponent_osu_id, beatmapset_id, beatmap_id, window_start, window_end, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
        )
        .run(
          me,
          opponent,
          beatmapsetId,
          Number.isFinite(beatmapId) ? beatmapId : null,
          now,
          windowEnd,
          now,
        );
      const battleId = info.lastInsertRowid;
      insertActivity(db, me, "battle_created", { battleId, opponentOsuId: opponent, beatmapsetId });
      return json(res, 201, { battleId });
    }

    if (method === "GET" && pathname === "/api/v1/battles") {
      const rows = db
        .prepare(
          `SELECT * FROM async_battles WHERE creator_osu_id = ? OR opponent_osu_id = ?
           ORDER BY created_at DESC LIMIT 50`,
        )
        .all(me, me);
      return json(res, 200, { battles: rows });
    }

    if (method === "GET" && /^\/api\/v1\/battles\/\d+$/.test(pathname)) {
      const id = Number(pathname.replace("/api/v1/battles/", ""));
      finalizeBattle(db, id);
      const b = db.prepare(`SELECT * FROM async_battles WHERE id = ? AND (creator_osu_id = ? OR opponent_osu_id = ?)`).get(
        id,
        me,
        me,
      );
      if (!b) return json(res, 404, { error: "not_found" });
      const scores = db.prepare(`SELECT * FROM score_submissions WHERE battle_id = ?`).all(id);
      return json(res, 200, { battle: b, scores });
    }

    if (method === "POST" && /^\/api\/v1\/battles\/\d+\/submit$/.test(pathname)) {
      const id = Number(pathname.match(/\/battles\/(\d+)\/submit/)?.[1]);
      const body = await readBody(req);
      const score = Number(body?.score);
      const mods = Number(body?.mods ?? 0);
      if (!Number.isFinite(score)) return json(res, 400, { error: "bad_request" });
      const b = db.prepare(`SELECT * FROM async_battles WHERE id = ?`).get(id);
      if (!b) return json(res, 404, { error: "not_found" });
      if (b.creator_osu_id !== me && b.opponent_osu_id !== me) return json(res, 403, { error: "forbidden" });
      if (b.state === "closed") return json(res, 400, { error: "closed" });
      const now = Date.now();
      if (now > b.window_end) {
        finalizeBattle(db, id);
        return json(res, 400, { error: "window_ended" });
      }
      const existing = db.prepare(`SELECT 1 FROM score_submissions WHERE battle_id = ? AND user_osu_id = ?`).get(id, me);
      if (existing) return json(res, 409, { error: "already_submitted" });
      db.prepare(
        `INSERT INTO score_submissions (battle_id, challenge_id, user_osu_id, score, mods, submitted_at)
         VALUES (?, NULL, ?, ?, ?, ?)`,
      ).run(id, me, Math.round(score), Math.round(mods), now);
      insertActivity(db, me, "battle_score", { battleId: id, score: Math.round(score) });
      finalizeBattle(db, id);
      const b2 = db.prepare(`SELECT * FROM async_battles WHERE id = ?`).get(id);
      const scores = db.prepare(`SELECT * FROM score_submissions WHERE battle_id = ?`).all(id);
      return json(res, 200, { battle: b2, scores });
    }

    return json(res, 404, { error: "not_found" });
  } catch (e) {
    console.error("[api]", e);
    return json(res, 500, { error: "internal", message: String(e?.message || e) });
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function insertActivity(db, actorOsuId, type, payloadObj) {
  const payload = JSON.stringify(payloadObj ?? {});
  db.prepare(`INSERT INTO activity_events (actor_osu_id, type, payload, created_at) VALUES (?, ?, ?, ?)`).run(
    actorOsuId,
    type,
    payload,
    Date.now(),
  );
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} battleId
 */
function finalizeBattle(db, battleId) {
  const b = db.prepare(`SELECT * FROM async_battles WHERE id = ?`).get(battleId);
  if (!b || b.state === "closed") return;
  const scores = db.prepare(`SELECT user_osu_id, score FROM score_submissions WHERE battle_id = ?`).all(battleId);
  const now = Date.now();
  const both =
    scores.some((s) => s.user_osu_id === b.creator_osu_id) && scores.some((s) => s.user_osu_id === b.opponent_osu_id);
  if (!both && now <= b.window_end) {
    if (scores.length > 0) {
      db.prepare(`UPDATE async_battles SET state = 'submitted' WHERE id = ? AND state = 'open'`).run(battleId);
    }
    return;
  }
  let winner = null;
  if (scores.length > 0) {
    const best = scores.reduce((a, s) => (s.score > a.score ? s : a));
    winner = best.user_osu_id;
  }
  db.prepare(`UPDATE async_battles SET state = 'closed', winner_osu_id = ? WHERE id = ?`).run(winner, battleId);
  insertActivity(db, b.creator_osu_id, "battle_finished", {
    battleId,
    winnerOsuId: winner,
    beatmapsetId: b.beatmapset_id,
  });
}

export { insertActivity };
