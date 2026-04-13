import { DEFAULT_PARTY_WS_URL, HOSTED_PARTY_WS_URL } from "./constants";

/**
 * Match Rust `settings::party_ws_to_http_base` / `resolve_social_api_base_from_saved_settings` for display-only hints.
 * The desktop app also calls `get_effective_social_api_base` — saved settings, then LAN mDNS, then default relay.
 */
/** If Social API base mistakenly uses party WS port 4680, map to REST port 4681 (matches Rust `normalize_social_api_http_base_party_port`). */
export function normalizeSocialApiHttpBasePartyPort(base: string): string {
  const b = base.trim().replace(/\/$/, "");
  const lower = b.toLowerCase();
  if (lower.endsWith(":4680")) {
    return `${b.slice(0, -":4680".length)}:4681`;
  }
  const idx = lower.indexOf(":4680/");
  if (idx !== -1) {
    return `${b.slice(0, idx)}:4681${b.slice(idx + 5)}`;
  }
  return b;
}

/** Match Rust `normalize_social_api_rest_base`: Caddy serves REST on 443; `https://domain:4681` is wrong from the internet. */
function shouldKeepHttpsExplicit4681(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return true;
}

function stripHttpsMistaken4681ForCaddyPublicHosts(base: string): string {
  const b = base.trim().replace(/\/$/, "");
  if (!b.toLowerCase().startsWith("https://")) return b;
  const without = b.slice("https://".length);
  const slash = without.indexOf("/");
  const auth = slash === -1 ? without : without.slice(0, slash);
  const tail = slash === -1 ? "" : without.slice(slash);
  if (!auth.endsWith(":4681")) return b;
  const host = auth.slice(0, -":4681".length);
  if (host.startsWith("[")) return b;
  if (shouldKeepHttpsExplicit4681(host)) return b;
  return `https://${host}${tail}`;
}

/** Full REST base normalization (matches desktop `social_api_*`). */
export function normalizeSocialApiRestBase(base: string): string {
  return stripHttpsMistaken4681ForCaddyPublicHosts(normalizeSocialApiHttpBasePartyPort(base));
}

export function partyWsToHttpBase(ws: string): string | null {
  const w = ws.trim();
  if (!w) return null;
  if (w.startsWith("ws://")) {
    const rest = w.slice("ws://".length);
    const colon = rest.lastIndexOf(":");
    if (colon !== -1) {
      const host = rest.slice(0, colon);
      const port = rest.slice(colon + 1);
      if (port === "4680") {
        return `http://${host}:4681`;
      }
    }
    return `http://${rest}`;
  }
  if (w.startsWith("wss://")) {
    const rest = w.slice("wss://".length);
    const colon = rest.lastIndexOf(":");
    if (colon !== -1) {
      const host = rest.slice(0, colon);
      const port = rest.slice(colon + 1);
      if (port === "4680") {
        return `https://${host}:4681`;
      }
    }
    return `https://${rest}`;
  }
  return null;
}

export function resolveSocialApiBaseUrl(
  partyServerUrl: string | null | undefined,
  socialApiBaseUrl: string | null | undefined,
): string | null {
  const override = socialApiBaseUrl?.trim();
  if (override) {
    return normalizeSocialApiRestBase(override);
  }
  const ws = (partyServerUrl?.trim() || HOSTED_PARTY_WS_URL || DEFAULT_PARTY_WS_URL).trim();
  const raw = partyWsToHttpBase(ws);
  return raw ? normalizeSocialApiRestBase(raw) : null;
}

/**
 * Match Rust `http_base_to_control_ws_url` / Discord control WebSocket derivation:
 * same host:port scheme as REST (`http` → `ws`, `https` → `wss`).
 */
export function httpBaseToDiscordControlWsUrl(base: string): string | null {
  const b = base.trim().replace(/\/$/, "");
  if (b.startsWith("https://")) {
    const rest = b.slice("https://".length);
    if (!rest) return null;
    return `wss://${rest}/control`;
  }
  if (b.startsWith("http://")) {
    const rest = b.slice("http://".length);
    if (!rest) return null;
    return `ws://${rest}/control`;
  }
  return null;
}
