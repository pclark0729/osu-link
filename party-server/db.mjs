/**
 * SQLite schema and helpers for osu-link social API.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS users (
    osu_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    avatar_url TEXT,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_low INTEGER NOT NULL,
    user_high INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
    requested_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_low, user_high)
  );
  CREATE INDEX IF NOT EXISTS idx_friendships_user_low ON friendships(user_low);
  CREATE INDEX IF NOT EXISTS idx_friendships_user_high ON friendships(user_high);
  `,
  `
  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_osu_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_osu_id INTEGER NOT NULL,
    beatmapset_id INTEGER NOT NULL,
    beatmap_id INTEGER,
    rules_json TEXT,
    deadline INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','closed')),
    created_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS challenge_participants (
    challenge_id INTEGER NOT NULL,
    user_osu_id INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (challenge_id, user_osu_id),
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS async_battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_osu_id INTEGER NOT NULL,
    opponent_osu_id INTEGER NOT NULL,
    beatmapset_id INTEGER NOT NULL,
    beatmap_id INTEGER,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('open','submitted','closed')),
    winner_osu_id INTEGER,
    created_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS score_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER,
    challenge_id INTEGER,
    user_osu_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    mods INTEGER NOT NULL DEFAULT 0,
    submitted_at INTEGER NOT NULL,
    CHECK((battle_id IS NOT NULL) OR (challenge_id IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_scores_battle ON score_submissions(battle_id);
  CREATE INDEX IF NOT EXISTS idx_scores_challenge ON score_submissions(challenge_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS user_achievements (
    osu_id INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    earned_at_ms INTEGER NOT NULL,
    PRIMARY KEY (osu_id, achievement_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_achievements_osu ON user_achievements(osu_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS discord_pairings (
    code TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS discord_control_sessions (
    discord_user_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_discord_control_sessions_hash ON discord_control_sessions(token_hash);
  `,
];

/**
 * ALTER ADD COLUMN is not idempotent — run once per missing column (every process start).
 * @param {import('better-sqlite3').Database} db
 */
function ensureScoreSubmissionsExtraColumns(db) {
  const cols = [
    ["pp", "REAL"],
    ["stars", "REAL"],
    ["play_beatmap_id", "INTEGER"],
    ["rank_value", "REAL"],
    ["baseline_pp_per_star", "REAL"],
    ["is_unweighted", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, def] of cols) {
    try {
      db.exec(`ALTER TABLE score_submissions ADD COLUMN ${name} ${def}`);
    } catch (e) {
      const msg = String(/** @type {Error} */ (e).message || e);
      if (!msg.includes("duplicate column")) throw e;
    }
  }
}

/**
 * @param {string} dbPath
 */
export function openDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
  ensureScoreSubmissionsExtraColumns(db);
  try {
    db.exec(`ALTER TABLE async_battles ADD COLUMN display_json TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    db.exec(`ALTER TABLE async_battles ADD COLUMN relative_pp INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column already exists */
  }
  return db;
}

/**
 * @param {string | undefined} envPath
 */
export function defaultDbPath(envPath) {
  if (envPath && envPath.trim()) return envPath.trim();
  return join(__dirname, "data", "social.sqlite");
}
