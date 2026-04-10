/** Default party coordination WebSocket URL (party-server default port, same machine only). */
export const DEFAULT_PARTY_WS_URL = "ws://127.0.0.1:4680";

/**
 * When set at build time (`VITE_PUBLIC_PARTY_WS_URL`), this becomes the default party server for
 * everyone who has not saved a custom URL — use a deployed `party-server` URL (usually `wss://…`).
 */
const rawPublic = import.meta.env.VITE_PUBLIC_PARTY_WS_URL;
export const PUBLIC_PARTY_WS_URL =
  typeof rawPublic === "string" && rawPublic.trim() !== "" ? rawPublic.trim() : undefined;

/** Resolution order: saved settings (elsewhere) → public default → local default. */
export function defaultPartyWsUrlFromSettings(saved: string | null | undefined): string {
  const t = saved?.trim();
  if (t) return t;
  return PUBLIC_PARTY_WS_URL ?? DEFAULT_PARTY_WS_URL;
}

/** Must match `OAUTH_LOOPBACK_PORT` in `src-tauri/src/oauth.rs`. */
export const OAUTH_REDIRECT_URI = "http://127.0.0.1:42813/callback";

export const OSU_OAUTH_NEW_APP_URL = "https://osu.ppy.sh/home/account/oauth/new";

export const OSU_OAUTH_LIST_URL = "https://osu.ppy.sh/home/account/oauth";
