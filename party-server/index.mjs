/**
 * osu-link party coordination server (WebSocket).
 * Protocol: see ../src/party/protocol.ts (v1).
 */

import { randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { handleSocialApi } from "./api.mjs";
import { defaultDbPath, openDatabase } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

const PORT = Number(process.env.PORT) || 4680;
/** Bind WebSocket: 0.0.0.0 for Pi/VPS/Docker; 127.0.0.1 for local-only */
const HOST = process.env.HOST || "127.0.0.1";
/** HTTP /health (default PORT+1 on 127.0.0.1). Set HEALTH_PORT=0 or DISABLE_HEALTH=1 to turn off. */
const HEALTH_DISABLED = process.env.DISABLE_HEALTH === "1" || process.env.HEALTH_PORT === "0";
const HEALTH_PORT = HEALTH_DISABLED ? 0 : Number(process.env.HEALTH_PORT) || PORT + 1;
const HEALTH_HOST = process.env.HEALTH_HOST || "127.0.0.1";
/** debug | info | warn | error */
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const DEBUG_WS = process.env.DEBUG_WS === "1";

const PROTOCOL_VERSION = 1;
const MAX_QUEUE = 100;
const MAX_LOBBIES = 500;
const MAX_MEMBERS_PER_LOBBY = 16;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
/** REST /api/v1 per-IP budget per minute */
const API_RATE_MAX = Number(process.env.API_RATE_MAX) || 300;
const SHUTDOWN_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

const log = {
  error: (msg, ...a) => {
    if (currentLevel >= LEVELS.error) console.error(`[${ts()}] [party] ERROR ${msg}`, ...a);
  },
  warn: (msg, ...a) => {
    if (currentLevel >= LEVELS.warn) console.warn(`[${ts()}] [party] WARN  ${msg}`, ...a);
  },
  info: (msg, ...a) => {
    if (currentLevel >= LEVELS.info) console.log(`[${ts()}] [party] INFO  ${msg}`, ...a);
  },
  debug: (msg, ...a) => {
    if (currentLevel >= LEVELS.debug) console.log(`[${ts()}] [party] DEBUG ${msg}`, ...a);
  },
};

/** @type {import('better-sqlite3').Database | null} */
let socialDb = null;
try {
  const dbPath = defaultDbPath(process.env.SOCIAL_DB_PATH);
  socialDb = openDatabase(dbPath);
  log.info(`Social API database ready (${dbPath})`);
} catch (e) {
  log.error(`Social database init failed: ${/** @type {Error} */ (e).message}`);
}

function checkApiRate(ip) {
  const now = Date.now();
  let b = apiRateBuckets.get(ip);
  if (!b || now - b.t0 > RATE_WINDOW_MS) {
    b = { t0: now, count: 0 };
    apiRateBuckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= API_RATE_MAX;
}

if (HEALTH_PORT !== 0 && HEALTH_PORT === PORT) {
  log.error(`HEALTH_PORT (${HEALTH_PORT}) cannot equal WebSocket PORT (${PORT}).`);
  process.exit(1);
}

const startedAt = Date.now();
let wsListening = false;
let wsConnections = 0;

const lobbies = new Map();
/** @type {WeakMap<import('ws').WebSocket, { memberId: string, lobbyCode: string }>} */
const socketMeta = new WeakMap();
const rateBuckets = new Map();
const apiRateBuckets = new Map();

function genCode() {
  let code;
  do {
    let s = "";
    for (let i = 0; i < 6; i++) {
      s += CROCKFORD[randomInt(CROCKFORD.length)];
    }
    code = s;
  } while (lobbies.has(code));
  return code;
}

function genMemberId() {
  return randomBytes(16).toString("hex");
}

function getClientIp(req) {
  const xf = req?.headers?.["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    return xf.split(",")[0].trim();
  }
  return req?.socket?.remoteAddress ?? "local";
}

function checkRate(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.t0 > RATE_WINDOW_MS) {
    b = { t0: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= RATE_MAX;
}

function lobbyStats() {
  let membersTotal = 0;
  for (const l of lobbies.values()) {
    membersTotal += l.members.size;
  }
  return { lobbyCount: lobbies.size, membersTotal };
}

function healthPayload() {
  const { lobbyCount, membersTotal } = lobbyStats();
  return {
    ok: true,
    service: "osu-link-party-server",
    version: pkg.version,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    protocolVersion: PROTOCOL_VERSION,
    database: {
      social: socialDb !== null,
    },
    websocket: {
      host: HOST,
      port: PORT,
      listening: wsListening,
      clients: wsConnections,
    },
    lobbies: {
      count: lobbyCount,
      membersTotal,
    },
  };
}

class Lobby {
  constructor(code, leaderId) {
    this.code = code;
    this.leaderId = leaderId;
    /** @type {Map<string, { displayName: string, ws: import('ws').WebSocket }>} */
    this.members = new Map();
    /** @type {string[]} */
    this.memberOrder = [];
    /** @type {Array<{ seq: number, setId: number, noVideo: boolean, artist?: string, title?: string, creator?: string, coverUrl?: string | null, fromMemberId: string }>} */
    this.queue = [];
    this.nextSeq = 1;
  }

  addMember(id, displayName, ws) {
    this.members.set(id, { displayName, ws });
    if (!this.memberOrder.includes(id)) this.memberOrder.push(id);
  }

  removeMember(id) {
    this.members.delete(id);
    this.memberOrder = this.memberOrder.filter((x) => x !== id);
    if (this.leaderId === id) {
      this.leaderId = this.memberOrder[0] ?? null;
    }
  }

  toPublicMembers() {
    return this.memberOrder
      .filter((id) => this.members.has(id))
      .map((id) => {
        const m = this.members.get(id);
        return { id, displayName: m?.displayName ?? "Player" };
      });
  }

  broadcast(obj, exceptWs = null) {
    const s = JSON.stringify(obj);
    for (const { ws } of this.members.values()) {
      if (ws === exceptWs) continue;
      if (ws.readyState === 1) ws.send(s);
    }
  }

  broadcastAll(obj) {
    const s = JSON.stringify(obj);
    for (const { ws } of this.members.values()) {
      if (ws.readyState === 1) ws.send(s);
    }
  }

  send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
}

function pruneEmptyLobbies() {
  if (lobbies.size <= MAX_LOBBIES) return;
  for (const [code, lobby] of lobbies) {
    if (lobby.members.size === 0) lobbies.delete(code);
  }
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {unknown} raw
 * @param {string} ip
 */
function handleMessage(ws, raw, ip) {
  let data;
  try {
    data = JSON.parse(String(raw));
  } catch {
    return lobbyForSocket(ws)?.send(ws, {
      type: "error",
      v: PROTOCOL_VERSION,
      message: "Invalid JSON",
    });
  }
  if (!data || typeof data !== "object" || data.v !== PROTOCOL_VERSION) {
    return safeError(ws, "Unsupported protocol version");
  }

  const type = data.type;
  if (DEBUG_WS) {
    log.debug(`ws msg type=${type} ip=${ip}`);
  }

  const meta = socketMeta.get(ws);

  if (type === "create_lobby") {
    if (!checkRate(ip)) return safeError(ws, "Rate limited");
    if (lobbies.size >= MAX_LOBBIES) return safeError(ws, "Server busy — try again later");
    if (meta) return safeError(ws, "Already in a lobby");
    const displayName = typeof data.displayName === "string" ? data.displayName : "Host";
    const memberId = genMemberId();
    const code = genCode();
    const lobby = new Lobby(code, memberId);
    lobby.addMember(memberId, displayName || "Host", ws);
    lobbies.set(code, lobby);
    socketMeta.set(ws, { memberId, lobbyCode: code });
    pruneEmptyLobbies();
    log.info(`lobby created code=${code} leader=${memberId.slice(0, 8)}… ip=${ip}`);
    return lobby.send(ws, {
      type: "welcome",
      v: PROTOCOL_VERSION,
      selfId: memberId,
      lobbyCode: code,
      leaderId: lobby.leaderId,
      members: lobby.toPublicMembers(),
      queued: lobby.queue.map((q) => ({ ...q })),
      seq: lobby.nextSeq - 1,
    });
  }

  if (type === "join_lobby") {
    if (!checkRate(ip)) return safeError(ws, "Rate limited");
    if (meta) return safeError(ws, "Already in a lobby");
    const code = String(data.code ?? "")
      .toUpperCase()
      .replace(/[^0-9A-HJKMNP-TV-Z]/g, "");
    if (code.length < 4) return safeError(ws, "Invalid lobby code");
    const lobby = lobbies.get(code);
    if (!lobby) return safeError(ws, "Lobby not found");
    if (lobby.members.size >= MAX_MEMBERS_PER_LOBBY) return safeError(ws, "Lobby is full");
    const displayName = typeof data.displayName === "string" ? data.displayName : "Player";
    const memberId = genMemberId();
    lobby.addMember(memberId, displayName || "Player", ws);
    socketMeta.set(ws, { memberId, lobbyCode: code });

    log.info(`lobby join code=${code} member=${memberId.slice(0, 8)}… ip=${ip} size=${lobby.members.size}`);

    lobby.send(ws, {
      type: "welcome",
      v: PROTOCOL_VERSION,
      selfId: memberId,
      lobbyCode: code,
      leaderId: lobby.leaderId ?? memberId,
      members: lobby.toPublicMembers(),
      queued: lobby.queue.map((q) => ({ ...q })),
      seq: lobby.nextSeq - 1,
    });

    const rosterMsg = {
      type: "roster",
      v: PROTOCOL_VERSION,
      leaderId: lobby.leaderId,
      members: lobby.toPublicMembers(),
      seq: lobby.nextSeq,
    };
    for (const [id, m] of lobby.members) {
      if (id === memberId) continue;
      lobby.send(m.ws, rosterMsg);
    }
    return;
  }

  if (!meta) return safeError(ws, "Join or create a lobby first");

  const lobby = lobbies.get(meta.lobbyCode);
  if (!lobby) {
    socketMeta.delete(ws);
    return safeError(ws, "Lobby no longer exists");
  }

  if (type === "leave_lobby") {
    log.info(`lobby leave code=${lobby.code} member=${meta.memberId.slice(0, 8)}…`);
    removeFromLobby(ws, lobby, meta.memberId);
    return;
  }

  if (type === "queue_beatmap") {
    if (meta.memberId !== lobby.leaderId) {
      return safeError(ws, "Only the party leader can queue beatmaps");
    }
    const setId = Number(data.setId);
    if (!Number.isFinite(setId) || setId <= 0) return safeError(ws, "Invalid beatmap set id");
    const noVideo = Boolean(data.noVideo);
    const entry = {
      seq: lobby.nextSeq++,
      fromMemberId: meta.memberId,
      setId,
      noVideo,
      artist: typeof data.artist === "string" ? data.artist : undefined,
      title: typeof data.title === "string" ? data.title : undefined,
      creator: typeof data.creator === "string" ? data.creator : undefined,
      coverUrl:
        typeof data.coverUrl === "string"
          ? data.coverUrl
          : data.coverUrl === null
            ? null
            : undefined,
    };
    lobby.queue.push(entry);
    while (lobby.queue.length > MAX_QUEUE) lobby.queue.shift();

    log.info(`queue_beatmap setId=${setId} noVideo=${noVideo} code=${lobby.code}`);

    const msg = {
      type: "beatmap_queued",
      v: PROTOCOL_VERSION,
      seq: entry.seq,
      fromMemberId: entry.fromMemberId,
      setId: entry.setId,
      noVideo: entry.noVideo,
      artist: entry.artist,
      title: entry.title,
      creator: entry.creator,
      coverUrl: entry.coverUrl,
    };
    lobby.broadcastAll(msg);
    return;
  }

  safeError(ws, "Unknown message type");
}

function lobbyForSocket(ws) {
  const meta = socketMeta.get(ws);
  if (!meta) return null;
  return lobbies.get(meta.lobbyCode) ?? null;
}

function safeError(ws, message) {
  log.debug(`client error: ${message}`);
  const lobby = lobbyForSocket(ws);
  if (lobby) lobby.send(ws, { type: "error", v: PROTOCOL_VERSION, message });
  else if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", v: PROTOCOL_VERSION, message }));
}

function removeFromLobby(ws, lobby, memberId) {
  lobby.removeMember(memberId);
  socketMeta.delete(ws);
  if (lobby.members.size === 0) {
    log.info(`lobby destroyed (empty) code=${lobby.code}`);
    lobbies.delete(lobby.code);
    return;
  }
  const rosterMsg = {
    type: "roster",
    v: PROTOCOL_VERSION,
    leaderId: lobby.leaderId,
    members: lobby.toPublicMembers(),
    seq: lobby.nextSeq,
  };
  lobby.broadcastAll(rosterMsg);
}

// --- WebSocket server ---

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("error", (err) => {
  log.error(`WebSocket server error: ${err.message}`);
  if (err.code === "EADDRINUSE") {
    log.error(`Port ${PORT} is already in use. Stop the other process or set PORT=…`);
  }
});

wss.on("listening", () => {
  wsListening = true;
  log.info(`WebSocket listening ws://${HOST}:${PORT} (protocol v${PROTOCOL_VERSION})`);
  log.info(`package ${pkg.name}@${pkg.version} | LOG_LEVEL=${LOG_LEVEL}${DEBUG_WS ? " DEBUG_WS=1" : ""}`);
});

wss.on("connection", (ws, req) => {
  wsConnections += 1;
  const ip = getClientIp(req);
  log.info(`client connected ip=${ip} open=${wsConnections}`);

  ws.on("message", (raw) => {
    try {
      handleMessage(ws, raw, ip);
    } catch (e) {
      log.error("handleMessage exception:", e);
      safeError(ws, "Internal error");
    }
  });

  ws.on("error", (err) => {
    log.warn(`client ws error ip=${ip}: ${err.message}`);
  });

  ws.on("close", () => {
    wsConnections = Math.max(0, wsConnections - 1);
    log.info(`client disconnected ip=${ip} open=${wsConnections}`);
    const meta = socketMeta.get(ws);
    if (!meta) return;
    const lobby = lobbies.get(meta.lobbyCode);
    socketMeta.delete(ws);
    if (!lobby) return;
    lobby.removeMember(meta.memberId);
    if (lobby.members.size === 0) {
      log.info(`lobby destroyed (last member left) code=${lobby.code}`);
      lobbies.delete(lobby.code);
      return;
    }
    const rosterMsg = {
      type: "roster",
      v: PROTOCOL_VERSION,
      leaderId: lobby.leaderId,
      members: lobby.toPublicMembers(),
      seq: lobby.nextSeq,
    };
    lobby.broadcastAll(rosterMsg);
  });
});

// --- HTTP health (local by default) ---

/** @type {http.Server | null} */
let healthServer = null;

if (HEALTH_PORT > 0) {
  healthServer = http.createServer((req, res) => {
    const fullUrl = req.url ?? "/";
    const pathname = new URL(fullUrl, "http://localhost").pathname;
    const method = req.method || "GET";

    if (pathname.startsWith("/api/v1")) {
      if (!socialDb) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "database_unavailable" }));
        return;
      }
      const ip = getClientIp(req);
      if (!checkApiRate(ip)) {
        res.statusCode = 429;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }
      void handleSocialApi(socialDb, req, res, method, pathname).catch((e) => {
        log.error("handleSocialApi exception:", e);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "internal" }));
        }
      });
      return;
    }

    const url = pathname;
    if (url === "/health" || url === "/healthz") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(healthPayload()));
      return;
    }
    if (url === "/ready") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const ready = wsListening;
      res.statusCode = ready ? 200 : 503;
      res.end(JSON.stringify({ ready, websocketListening: wsListening }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  healthServer.on("error", (err) => {
    log.error(`Health HTTP server error: ${err.message}`);
  });

  healthServer.listen(HEALTH_PORT, HEALTH_HOST, () => {
    log.info(`Health HTTP http://${HEALTH_HOST}:${HEALTH_PORT}/health (GET JSON status)`);
  });
} else {
  log.info("Health HTTP disabled (HEALTH_PORT=0 or DISABLE_HEALTH=1)");
}

// --- Graceful shutdown ---

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`signal ${signal} — closing servers (${SHUTDOWN_MS}ms timeout)…`);

  const force = setTimeout(() => {
    log.error("shutdown timeout, exiting");
    process.exit(1);
  }, SHUTDOWN_MS);

  const finish = () => {
    clearTimeout(force);
    log.info("shutdown complete");
    process.exit(0);
  };

  let pending = healthServer ? 2 : 1;

  const step = (label, err) => {
    if (err) log.warn(`${label}: ${err.message}`);
    pending -= 1;
    if (pending <= 0) finish();
  };

  if (socialDb) {
    try {
      socialDb.close();
      socialDb = null;
    } catch (e) {
      log.warn(`sqlite close: ${/** @type {Error} */ (e).message}`);
    }
  }

  if (healthServer) {
    healthServer.close((err) => step("health close", err));
  }
  wss.close((err) => step("wss close", err));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
