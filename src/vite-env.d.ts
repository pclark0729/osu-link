/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public party WebSocket URL baked into builds (e.g. wss://party.example.com). */
  readonly VITE_PUBLIC_PARTY_WS_URL?: string;
}
