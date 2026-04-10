import { DEFAULT_PARTY_WS_URL, HOSTED_PARTY_WS_URL } from "./constants";

/**
 * Match Rust `settings::party_ws_to_http_base` / `resolve_social_api_base` for display-only hints.
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
