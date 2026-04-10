import { defaultPartyWsUrlFromSettings, PARTY_EXTRA_CONNECT_WS_URLS } from "../constants";

const rawBuildFallback = import.meta.env.VITE_PARTY_WS_FALLBACK_URL;
const rawExtraList = import.meta.env.VITE_PARTY_EXTRA_WS_URLS;

function parseExtraWsUrls(raw: string | undefined): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Optional extra URL to try last (build-time, e.g. custom `ws://` endpoint). */
export function getPartyWsFallbackFromBuild(): string | undefined {
  if (typeof rawBuildFallback !== "string") return undefined;
  const t = rawBuildFallback.trim();
  return t || undefined;
}

/**
 * Same host as `wss://…`, plain `ws://` on party-server port — for LAN when the Pi listens on 0.0.0.0:4680
 * (avoids TLS + can work on home Wi‑Fi when public `wss://` fails due to NAT hairpin).
 */
export function derivedSameNetworkPartyWsUrl(primaryWsUrl: string): string | undefined {
  try {
    const u = new URL(primaryWsUrl.trim());
    if (u.protocol !== "wss:") return undefined;
    return `ws://${u.hostname}:4680`;
  } catch {
    return undefined;
  }
}

/**
 * URLs to try in order:
 * primary → same-host `ws://…:4680` → {@link VITE_PARTY_EXTRA_WS_URLS} (LAN / Tailscale IPs) → {@link VITE_PARTY_WS_FALLBACK_URL}.
 */
export function buildPartyConnectUrlCandidates(savedPartyUrl: string | null | undefined): string[] {
  const primary = defaultPartyWsUrlFromSettings(savedPartyUrl);
  const out: string[] = [];
  const push = (u: string) => {
    const t = u.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(primary);
  const derived = derivedSameNetworkPartyWsUrl(primary);
  if (derived) push(derived);
  for (const u of PARTY_EXTRA_CONNECT_WS_URLS) {
    push(u);
  }
  for (const u of parseExtraWsUrls(rawExtraList)) {
    push(u);
  }
  const bf = getPartyWsFallbackFromBuild();
  if (bf) push(bf);
  return out;
}
