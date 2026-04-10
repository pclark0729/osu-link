/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public party WebSocket URL baked into builds (e.g. wss://party.example.com). */
  readonly VITE_PUBLIC_PARTY_WS_URL?: string;
  /** Optional extra URL tried after the primary (e.g. ws://192.168.1.50:4680 for LAN / NAT hairpin workaround). */
  readonly VITE_PARTY_WS_FALLBACK_URL?: string;
  /**
   * Comma/space-separated `ws://` URLs tried after `ws://hostname:4680` (e.g. Pi LAN + Tailscale `100.x` addresses).
   * Bypasses broken NAT hairpin when the public hostname resolves to the WAN IP from inside the home network.
   */
  readonly VITE_PARTY_EXTRA_WS_URLS?: string;
}
