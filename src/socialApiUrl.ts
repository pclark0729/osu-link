import { DEFAULT_PARTY_WS_URL, HOSTED_PARTY_WS_URL } from "./constants";

/**
 * Match Rust `settings::party_ws_to_http_base` / `resolve_social_api_base_from_saved_settings` for display-only hints.
 * (Runtime also tries LAN mDNS via `party_discovery::resolve_social_api_base_effective`.)
 */
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
    return override.replace(/\/$/, "");
  }
  const ws = (partyServerUrl?.trim() || HOSTED_PARTY_WS_URL || DEFAULT_PARTY_WS_URL).trim();
  return partyWsToHttpBase(ws);
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
