import { encodeClientMessage, parseServerMessage, PARTY_PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "./protocol";
import { describePartyWsFailure } from "./partyConnectErrors";

export type PartyConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface PartyClientState {
  connection: PartyConnectionState;
  lastError: string | null;
  url: string;
  selfId: string | null;
  lobbyCode: string | null;
  leaderId: string | null;
  members: { id: string; displayName: string }[];
  lastSeq: number;
}

const initialClientState = (url: string): PartyClientState => ({
  connection: "disconnected",
  lastError: null,
  url,
  selfId: null,
  lobbyCode: null,
  leaderId: null,
  members: [],
  lastSeq: 0,
});

export type PartyEvent =
  | { kind: "state"; state: PartyClientState }
  | { kind: "beatmap_queued"; msg: Extract<ServerMessage, { type: "beatmap_queued" }> };

export class PartyClient {
  private ws: WebSocket | null = null;
  private state: PartyClientState;
  private onEvent: (e: PartyEvent) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(initialUrl: string, onEvent: (e: PartyEvent) => void) {
    this.state = initialClientState(initialUrl);
    this.onEvent = onEvent;
  }

  getState(): PartyClientState {
    return this.state;
  }

  setUrl(url: string) {
    this.state = { ...this.state, url: url.trim() || this.state.url };
    this.emitState();
  }

  connect(onOpen?: () => void, urlCandidates?: string[]) {
    this.closedByUser = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.state = { ...this.state, connection: "connected", lastError: null };
      this.emitState();
      onOpen?.();
      return;
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.clearReconnect();

    const raw =
      urlCandidates && urlCandidates.length > 0
        ? urlCandidates
        : [this.state.url.trim() || "ws://127.0.0.1:4680"];
    const urls: string[] = [];
    for (const u of raw) {
      const t = u.trim();
      if (t && !urls.includes(t)) urls.push(t);
    }
    if (urls.length === 0) urls.push("ws://127.0.0.1:4680");

    const displayUrl = urls[0];
    this.state = { ...this.state, connection: "connecting", lastError: null, url: displayUrl };
    this.emitState();

    let connectionSucceeded = false;

    const bindMessages = (ws: WebSocket) => {
      ws.onmessage = (ev) => {
        const msg = parseServerMessage(String(ev.data));
        if (!msg) return;
        if (msg.type === "error") {
          this.state = { ...this.state, lastError: msg.message };
          this.emitState();
          return;
        }
        if (msg.type === "welcome") {
          this.state = {
            ...this.state,
            selfId: msg.selfId,
            lobbyCode: msg.lobbyCode,
            leaderId: msg.leaderId,
            members: msg.members,
            lastSeq: msg.seq,
            lastError: null,
          };
          this.emitState();
          return;
        }
        if (msg.type === "roster") {
          this.state = {
            ...this.state,
            leaderId: msg.leaderId,
            members: msg.members,
            lastSeq: msg.seq,
          };
          this.emitState();
          return;
        }
        if (msg.type === "beatmap_queued") {
          this.state = { ...this.state, lastSeq: msg.seq };
          this.emitState();
          this.onEvent({ kind: "beatmap_queued", msg });
        }
      };
    };

    const tryOpen = (index: number) => {
      if (this.closedByUser) return;
      if (index >= urls.length) {
        if (!connectionSucceeded) {
          const last = urls[urls.length - 1] ?? displayUrl;
          this.state = {
            ...initialClientState(displayUrl),
            url: displayUrl,
            connection: "error",
            lastError: describePartyWsFailure(1006, "", last),
          };
          this.emitState();
        }
        return;
      }

      const url = urls[index];
      this.state = { ...this.state, connection: "connecting", url };
      this.emitState();

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        tryOpen(index + 1);
        return;
      }

      this.ws = ws;
      bindMessages(ws);

      ws.onopen = () => {
        connectionSucceeded = true;
        this.state = { ...this.state, connection: "connected", lastError: null, url };
        this.emitState();
        onOpen?.();
      };

      ws.onerror = () => {};

      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.ws = null;

        if (connectionSucceeded) {
          const wasConnected = this.state.selfId !== null;
          this.state = {
            ...initialClientState(this.state.url),
            url: this.state.url,
            connection: this.closedByUser ? "disconnected" : wasConnected ? "error" : "disconnected",
            lastError: this.closedByUser
              ? null
              : wasConnected
                ? "Disconnected from party server."
                : null,
          };
          this.emitState();
          if (!this.closedByUser && wasConnected) {
            this.scheduleReconnect();
          }
          return;
        }

        if (!this.closedByUser && index + 1 < urls.length) {
          tryOpen(index + 1);
          return;
        }

        if (!this.closedByUser) {
          const failOpen = ev.code !== 1000 && ev.code !== 1001;
          this.state = {
            ...initialClientState(displayUrl),
            url: displayUrl,
            connection: failOpen ? "error" : "disconnected",
            lastError: failOpen ? describePartyWsFailure(ev.code, ev.reason, url) : null,
          };
          this.emitState();
        }
      };
    };

    tryOpen(0);
  }

  disconnect() {
    this.closedByUser = true;
    this.clearReconnect();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = { ...initialClientState(this.state.url), url: this.state.url };
    this.emitState();
  }

  private scheduleReconnect() {
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitState() {
    this.onEvent({ kind: "state", state: this.state });
  }

  private send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encodeClientMessage(msg));
    return true;
  }

  createLobby(displayName: string) {
    return this.send({
      type: "create_lobby",
      v: PARTY_PROTOCOL_VERSION,
      displayName: displayName.trim() || "Host",
    });
  }

  joinLobby(code: string, displayName: string) {
    const c = code.trim().toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, "");
    return this.send({
      type: "join_lobby",
      v: PARTY_PROTOCOL_VERSION,
      code: c,
      displayName: displayName.trim() || "Player",
    });
  }

  queueBeatmap(payload: {
    setId: number;
    noVideo: boolean;
    artist?: string;
    title?: string;
    creator?: string;
    coverUrl?: string | null;
  }) {
    return this.send({
      type: "queue_beatmap",
      v: PARTY_PROTOCOL_VERSION,
      setId: payload.setId,
      noVideo: payload.noVideo,
      artist: payload.artist,
      title: payload.title,
      creator: payload.creator,
      coverUrl: payload.coverUrl ?? undefined,
    });
  }

  leaveLobby() {
    const ok = this.send({ type: "leave_lobby", v: PARTY_PROTOCOL_VERSION });
    const stillOpen = this.ws?.readyState === WebSocket.OPEN;
    this.state = {
      ...initialClientState(this.state.url),
      url: this.state.url,
      connection: stillOpen ? "connected" : "disconnected",
      lastError: null,
    };
    this.emitState();
    return ok;
  }
}
