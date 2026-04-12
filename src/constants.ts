/** Default party coordination WebSocket URL (party-server default port, same machine only). */
export const DEFAULT_PARTY_WS_URL = "ws://127.0.0.1:4680";

/**
 * Shared party host for this distribution. Override with `VITE_PUBLIC_PARTY_WS_URL` at build time.
 * Hostname only must match default `PUBLIC_DOMAIN` in `party-server/install-pi.sh` (currently osulink.peyton-clark.com).
 */
export const HOSTED_PARTY_WS_URL = "wss://osulink.peyton-clark.com";

/**
 * Default party server for users who have not saved a custom URL (`partyServerUrl`).
 * Build-time `VITE_PUBLIC_PARTY_WS_URL` wins; otherwise {@link HOSTED_PARTY_WS_URL}.
 */
const rawPublic = import.meta.env.VITE_PUBLIC_PARTY_WS_URL;
export const PUBLIC_PARTY_WS_URL =
  typeof rawPublic === "string" && rawPublic.trim() !== "" ? rawPublic.trim() : HOSTED_PARTY_WS_URL;

/** When true, Party and Settings hide the WebSocket URL field (fixed host). */
export const PARTY_SERVER_URL_UI_HIDDEN = true;

/**
 * Extra `ws://` URLs tried after `wss://` and `ws://public-host:4680` (NAT hairpin workaround).
 * Pi must use `HOST=0.0.0.0` on port 4680. Update if DHCP changes; use `VITE_PARTY_EXTRA_WS_URLS` to override without editing code.
 *
 * The first host is also used server-side as an HTTP fallback for Discord pairing (`http://192.168.1.43:4681` in `party_discovery.rs`).
 */
export const PARTY_EXTRA_CONNECT_WS_URLS: readonly string[] = [
  "ws://192.168.1.43:4680",
  "ws://100.86.89.104:4680",
];

/** Resolution order: saved settings (elsewhere) → public default → local default. */
export function defaultPartyWsUrlFromSettings(saved: string | null | undefined): string {
  const t = saved?.trim();
  if (t) return t;
  return PUBLIC_PARTY_WS_URL ?? DEFAULT_PARTY_WS_URL;
}

/** Default global shortcuts (Tauri format); persisted in settings. */
export const DEFAULT_HOTKEY_FOCUS_SEARCH = "Alt+Shift+O";
export const DEFAULT_HOTKEY_RANDOM_CURATE = "Alt+Shift+R";
export const DEFAULT_HOTKEY_TRAIN_OPEN = "Alt+Shift+B";
export const DEFAULT_HOTKEY_TRAIN_RANDOMIZE = "Alt+Shift+U";
export const DEFAULT_HOTKEY_TRAIN_END = "Alt+Shift+X";

/** Must match `OAUTH_LOOPBACK_PORT` in `src-tauri/src/oauth.rs`. */
export const OAUTH_REDIRECT_URI = "http://127.0.0.1:42813/callback";

export const OSU_OAUTH_NEW_APP_URL = "https://osu.ppy.sh/home/account/oauth/new";

export const OSU_OAUTH_LIST_URL = "https://osu.ppy.sh/home/account/oauth";
