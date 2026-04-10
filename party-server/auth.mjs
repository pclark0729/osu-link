/**
 * Validate osu! OAuth tokens via GET /api/v2/me with short TTL cache.
 */

const OSU_ME = "https://osu.ppy.sh/api/v2/me";
const CACHE_TTL_MS = 90_000;

/** @type {Map<string, { at: number, user: { osuId: number, username: string, avatarUrl: string | null } }>} */
const cache = new Map();

/**
 * @param {string} token
 * @returns {Promise<{ ok: true, user: { osuId: number, username: string, avatarUrl: string | null } } | { ok: false, status: number, body: string }>}
 */
export async function validateBearer(token) {
  const t = token.trim();
  if (!t) {
    return { ok: false, status: 401, body: "Missing bearer token" };
  }
  const hit = cache.get(t);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { ok: true, user: hit.user };
  }

  const res = await fetch(OSU_ME, {
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, status: 502, body: "Invalid JSON from osu!" };
  }
  const osuId = Number(data.id);
  if (!Number.isFinite(osuId)) {
    return { ok: false, status: 502, body: "Invalid /me payload" };
  }
  const username = typeof data.username === "string" ? data.username : String(osuId);
  const avatarUrl =
    typeof data.avatar_url === "string"
      ? data.avatar_url
      : typeof data.avatarUrl === "string"
        ? data.avatarUrl
        : null;
  const user = { osuId, username, avatarUrl };
  cache.set(t, { at: now, user });
  return { ok: true, user };
}

export function clearAuthCacheForTests() {
  cache.clear();
}
