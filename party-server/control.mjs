/**
 * Discord remote control relay: WebSocket /control + pairing REST + internal bot API.
 * Protocol version 1 — wire messages use { v: 1, ... }.
 */
import { createHash, randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";

const PROTOCOL_V = 1;
const PAIRING_TTL_MS = 15 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 45_000;
const PAIRING_BODY_MAX = 4096;

/** @param {import('better-sqlite3').Database} db */
function pruneExpiredPairings(db) {
  const now = Date.now();
  db.prepare("DELETE FROM discord_pairings WHERE expires_at < ?").run(now);
}

/**
 * @param {string} token
 */
export function hashDiscordSessionToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * @param {import('http').IncomingMessage} req
 */
function isLoopback(req) {
  const a = req.socket?.remoteAddress;
  if (a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1") return true;
  return false;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on("data", (c) => {
      len += c.length;
      if (len > PAIRING_BODY_MAX) {
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(c);
    });
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

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {{ error: Function, warn: Function, info: Function }} opts.log
 * @param {(ip: string) => boolean} opts.checkPairingRate
 * @param {(ip: string) => boolean} [opts.checkInternalRate]
 */
export function createControlRelay(opts) {
  const { db, log, checkPairingRate } = opts;
  const checkInternalRate = opts.checkInternalRate ?? (() => true);
  const internalSecret = (process.env.DISCORD_INTERNAL_SECRET || "").trim();

  /** @type {Map<string, import('ws').WebSocket>} */
  const socketsByDiscord = new Map();
  /** @type {Map<string, { resolve: (v: unknown) => void, timer: ReturnType<typeof setTimeout> }>} */
  const pendingResults = new Map();

  const controlWss = new WebSocketServer({ noServer: true });

  /**
   * @param {import('ws').WebSocket} ws
   * @param {string} discordUserId
   */
  function bindControlSocket(ws, discordUserId) {
    const prev = socketsByDiscord.get(discordUserId);
    if (prev && prev !== ws && prev.readyState === 1) {
      try {
        prev.close(4000, "replaced");
      } catch {
        /* ignore */
      }
    }
    socketsByDiscord.set(discordUserId, ws);
    log.info(`[control] desktop connected discordUserId=${discordUserId}`);

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      const id = typeof data.id === "string" ? data.id : "";
      if (!id || !pendingResults.has(id)) return;
      const p = pendingResults.get(id);
      if (p) {
        clearTimeout(p.timer);
        pendingResults.delete(id);
        p.resolve(data);
      }
    });

    ws.on("close", () => {
      if (socketsByDiscord.get(discordUserId) === ws) {
        socketsByDiscord.delete(discordUserId);
      }
      log.info(`[control] desktop disconnected discordUserId=${discordUserId}`);
    });

    ws.on("error", (err) => {
      log.warn(`[control] ws error: ${err.message}`);
    });

    try {
      ws.send(JSON.stringify({ v: PROTOCOL_V, type: "hello", ok: true }));
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {string} discordUserId
   * @param {Record<string, unknown>} commandPayload
   * @returns {Promise<unknown>}
   */
  function dispatchToDesktop(discordUserId, commandPayload) {
    const ws = socketsByDiscord.get(discordUserId);
    if (!ws || ws.readyState !== 1) {
      return Promise.reject(new Error("desktop_offline"));
    }
    const id = randomBytes(12).toString("hex");
    const msg = { v: PROTOCOL_V, id, ...commandPayload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResults.delete(id);
        reject(new Error("timeout"));
      }, COMMAND_TIMEOUT_MS);
      pendingResults.set(id, {
        resolve: (data) => resolve(data),
        timer,
      });
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(timer);
        pendingResults.delete(id);
        reject(e);
      }
    });
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {string} pathname
   * @param {string} method
   * @param {string} ip
   */
  async function handleHttpRequest(req, res, pathname, method, ip) {
    if (pathname === "/internal/discord/link" && method === "POST") {
      if (!isLoopback(req)) {
        res.statusCode = 403;
        res.end();
        return true;
      }
      if (!internalSecret) {
        json(res, 503, { error: "internal_secret_not_configured" });
        return true;
      }
      const hdr = req.headers["x-internal-secret"];
      if (typeof hdr !== "string" || hdr !== internalSecret) {
        json(res, 401, { error: "unauthorized" });
        return true;
      }
      if (!checkInternalRate(ip)) {
        json(res, 429, { error: "rate_limited" });
        return true;
      }
      let body;
      try {
        body = await readBody(req);
      } catch {
        json(res, 400, { error: "invalid_json" });
        return true;
      }
      const code = normalizeCode(body?.code);
      const discordUserId = typeof body?.discordUserId === "string" ? body.discordUserId.trim() : "";
      if (!code || !discordUserId) {
        json(res, 400, { error: "invalid_body" });
        return true;
      }
      pruneExpiredPairings(db);
      const row = db.prepare("SELECT token_hash FROM discord_pairings WHERE code = ?").get(code);
      if (!row) {
        json(res, 404, { error: "unknown_or_expired_code" });
        return true;
      }
      const tokenHash = row.token_hash;
      const now = Date.now();
      db.prepare(
        `INSERT INTO discord_control_sessions (discord_user_id, token_hash, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(discord_user_id) DO UPDATE SET token_hash = excluded.token_hash, updated_at = excluded.updated_at`,
      ).run(discordUserId, tokenHash, now);
      db.prepare("DELETE FROM discord_pairings WHERE code = ?").run(code);
      json(res, 200, { ok: true, linked: true });
      return true;
    }

    if (pathname === "/internal/discord/command" && method === "POST") {
      if (!isLoopback(req)) {
        res.statusCode = 403;
        res.end();
        return true;
      }
      if (!internalSecret) {
        json(res, 503, { error: "internal_secret_not_configured" });
        return true;
      }
      const hdr = req.headers["x-internal-secret"];
      if (typeof hdr !== "string" || hdr !== internalSecret) {
        json(res, 401, { error: "unauthorized" });
        return true;
      }
      if (!checkInternalRate(ip)) {
        json(res, 429, { error: "rate_limited" });
        return true;
      }
      let body;
      try {
        body = await readBody(req);
      } catch {
        json(res, 400, { error: "invalid_json" });
        return true;
      }
      const discordUserId = typeof body?.discordUserId === "string" ? body.discordUserId.trim() : "";
      const command = typeof body?.command === "string" ? body.command.trim() : "";
      if (!discordUserId || !command) {
        json(res, 400, { error: "invalid_body" });
        return true;
      }

      const payload = { command };
      if (body.command === "download") {
        const setId = Number(body.beatmapsetId);
        if (!Number.isFinite(setId) || setId <= 0) {
          json(res, 400, { error: "invalid_beatmapset_id" });
          return true;
        }
        payload.beatmapsetId = setId;
        payload.noVideo = Boolean(body.noVideo);
      } else if (body.command === "search") {
        const q = typeof body.query === "string" ? body.query.trim() : "";
        if (!q || q.length > 200) {
          json(res, 400, { error: "invalid_query" });
          return true;
        }
        payload.query = q;
      } else if (body.command !== "ping") {
        json(res, 400, { error: "unknown_command" });
        return true;
      }

      try {
        const result = await dispatchToDesktop(discordUserId, payload);
        json(res, 200, { ok: true, result });
      } catch (e) {
        const msg = /** @type {Error} */ (e).message;
        if (msg === "desktop_offline") {
          json(res, 503, { ok: false, error: "desktop_offline" });
        } else if (msg === "timeout") {
          json(res, 504, { ok: false, error: "timeout" });
        } else {
          json(res, 500, { ok: false, error: msg || "internal" });
        }
      }
      return true;
    }

    if (pathname === "/api/v1/discord-control/pairing" && method === "POST") {
      if (!checkPairingRate(ip)) {
        json(res, 429, { error: "rate_limited" });
        return true;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        if (/** @type {Error} */ (e).message === "body_too_large") {
          json(res, 413, { error: "body_too_large" });
          return true;
        }
        json(res, 400, { error: "invalid_json" });
        return true;
      }
      const code = normalizeCode(body?.code);
      const tokenHash = typeof body?.tokenHash === "string" ? body.tokenHash.trim().toLowerCase() : "";
      if (!code || !/^[0-9a-f]{64}$/.test(tokenHash)) {
        json(res, 400, { error: "invalid_body" });
        return true;
      }
      pruneExpiredPairings(db);
      const now = Date.now();
      const expiresAt = now + PAIRING_TTL_MS;
      db.prepare(
        `INSERT INTO discord_pairings (code, token_hash, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
      ).run(code, tokenHash, expiresAt);
      json(res, 200, { ok: true, expiresInSec: Math.floor(PAIRING_TTL_MS / 1000) });
      return true;
    }

    if (pathname === "/api/v1/discord-control/status" && method === "GET") {
      const auth = req.headers.authorization;
      const bearer =
        typeof auth === "string" && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (!bearer) {
        json(res, 401, { error: "missing_token" });
        return true;
      }
      const tokenHash = hashDiscordSessionToken(bearer);
      const row = db
        .prepare("SELECT discord_user_id FROM discord_control_sessions WHERE token_hash = ?")
        .get(tokenHash);
      if (!row) {
        json(res, 200, { linked: false, online: false });
        return true;
      }
      const discordUserId = row.discord_user_id;
      const ws = socketsByDiscord.get(discordUserId);
      const online = Boolean(ws && ws.readyState === 1);
      json(res, 200, { linked: true, discordUserId, online });
      return true;
    }

    if (pathname === "/api/v1/discord-control/revoke" && method === "POST") {
      const auth = req.headers.authorization;
      const bearer =
        typeof auth === "string" && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (!bearer) {
        json(res, 401, { error: "missing_token" });
        return true;
      }
      const tokenHash = hashDiscordSessionToken(bearer);
      const row = db
        .prepare("SELECT discord_user_id FROM discord_control_sessions WHERE token_hash = ?")
        .get(tokenHash);
      if (!row) {
        json(res, 200, { ok: true, revoked: false });
        return true;
      }
      db.prepare("DELETE FROM discord_control_sessions WHERE token_hash = ?").run(tokenHash);
      const ws = socketsByDiscord.get(row.discord_user_id);
      if (ws && ws.readyState === 1) {
        try {
          ws.close(4001, "revoked");
        } catch {
          /* ignore */
        }
      }
      socketsByDiscord.delete(row.discord_user_id);
      json(res, 200, { ok: true, revoked: true });
      return true;
    }

    return false;
  }

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/control") {
      socket.destroy();
      return;
    }
    const auth = req.headers.authorization;
    const bearer =
      typeof auth === "string" && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!bearer) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const tokenHash = hashDiscordSessionToken(bearer);
    const row = db.prepare("SELECT discord_user_id FROM discord_control_sessions WHERE token_hash = ?").get(tokenHash);
    if (!row) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const discordUserId = row.discord_user_id;
    controlWss.handleUpgrade(req, socket, head, (ws) => {
      bindControlSocket(ws, discordUserId);
    });
  }

  function getHealthExtras() {
    return {
      discordControl: {
        protocolVersion: PROTOCOL_V,
        desktopSessions: socketsByDiscord.size,
      },
    };
  }

  return {
    handleHttpRequest,
    handleUpgrade,
    getHealthExtras,
    PROTOCOL_V,
  };
}

/**
 * @param {unknown} code
 */
function normalizeCode(code) {
  if (typeof code !== "string") return "";
  return code
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "")
    .slice(0, 8);
}
