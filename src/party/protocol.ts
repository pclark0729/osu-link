/** Wire format version for osu-link party lobbies. Bump when breaking. */
export const PARTY_PROTOCOL_VERSION = 2 as const;

export interface PartyMemberWire {
  id: string;
  displayName: string;
}

export interface QueuedBeatmapWire {
  seq: number;
  setId: number;
  noVideo: boolean;
  artist?: string;
  title?: string;
  creator?: string;
  coverUrl?: string | null;
  fromMemberId: string;
}

/** Recent chat lines included in welcome for late joiners */
export interface LobbyChatWire {
  memberId: string;
  text: string;
  ts: number;
}

/** Messages client → coordination server */
export type ClientMessage =
  | {
      type: "create_lobby";
      v: typeof PARTY_PROTOCOL_VERSION;
      displayName: string;
    }
  | {
      type: "join_lobby";
      v: typeof PARTY_PROTOCOL_VERSION;
      code: string;
      displayName: string;
    }
  | {
      type: "queue_beatmap";
      v: typeof PARTY_PROTOCOL_VERSION;
      setId: number;
      noVideo: boolean;
      artist?: string;
      title?: string;
      creator?: string;
      coverUrl?: string | null;
    }
  | { type: "leave_lobby"; v: typeof PARTY_PROTOCOL_VERSION }
  | { type: "chat"; v: typeof PARTY_PROTOCOL_VERSION; text: string }
  | { type: "transfer_leadership"; v: typeof PARTY_PROTOCOL_VERSION; targetMemberId: string }
  | { type: "clear_queue"; v: typeof PARTY_PROTOCOL_VERSION }
  | { type: "remove_queue_item"; v: typeof PARTY_PROTOCOL_VERSION; seq: number };

/** Messages server → client */
export type ServerMessage =
  | { type: "error"; v: typeof PARTY_PROTOCOL_VERSION; message: string }
  | {
      type: "welcome";
      v: typeof PARTY_PROTOCOL_VERSION;
      selfId: string;
      lobbyCode: string;
      leaderId: string;
      members: PartyMemberWire[];
      queued: QueuedBeatmapWire[];
      chatTail: LobbyChatWire[];
      seq: number;
    }
  | {
      type: "roster";
      v: typeof PARTY_PROTOCOL_VERSION;
      leaderId: string;
      members: PartyMemberWire[];
      seq: number;
    }
  | {
      type: "beatmap_queued";
      v: typeof PARTY_PROTOCOL_VERSION;
      seq: number;
      fromMemberId: string;
      setId: number;
      noVideo: boolean;
      artist?: string;
      title?: string;
      creator?: string;
      coverUrl?: string | null;
      /** Full lobby queue after this enqueue (avoids a separate round-trip). */
      queuedAfter: QueuedBeatmapWire[];
    }
  | {
      type: "queue_sync";
      v: typeof PARTY_PROTOCOL_VERSION;
      queued: QueuedBeatmapWire[];
      seq: number;
    }
  | {
      type: "lobby_chat";
      v: typeof PARTY_PROTOCOL_VERSION;
      memberId: string;
      text: string;
      ts: number;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  if (data.v !== PARTY_PROTOCOL_VERSION) return null;
  const t = data.type;
  if (t === "error" && typeof data.message === "string") {
    return { type: "error", v: PARTY_PROTOCOL_VERSION, message: data.message };
  }
  if (t === "welcome") {
    const selfId = typeof data.selfId === "string" ? data.selfId : "";
    const lobbyCode = typeof data.lobbyCode === "string" ? data.lobbyCode : "";
    const leaderId = typeof data.leaderId === "string" ? data.leaderId : "";
    const seq = typeof data.seq === "number" ? data.seq : 0;
    const members = parseMembers(data.members);
    const queued = parseQueued(data.queued);
    const chatTail = parseChatTail(data.chatTail);
    if (!selfId || !lobbyCode) return null;
    return {
      type: "welcome",
      v: PARTY_PROTOCOL_VERSION,
      selfId,
      lobbyCode,
      leaderId,
      members,
      queued,
      chatTail,
      seq,
    };
  }
  if (t === "roster") {
    const leaderId = typeof data.leaderId === "string" ? data.leaderId : "";
    const seq = typeof data.seq === "number" ? data.seq : 0;
    return {
      type: "roster",
      v: PARTY_PROTOCOL_VERSION,
      leaderId,
      members: parseMembers(data.members),
      seq,
    };
  }
  if (t === "beatmap_queued") {
    const setId = Number(data.setId);
    if (!Number.isFinite(setId)) return null;
    const queuedAfter = parseQueued(data.queuedAfter);
    return {
      type: "beatmap_queued",
      v: PARTY_PROTOCOL_VERSION,
      seq: typeof data.seq === "number" ? data.seq : 0,
      fromMemberId: typeof data.fromMemberId === "string" ? data.fromMemberId : "",
      setId,
      noVideo: Boolean(data.noVideo),
      artist: typeof data.artist === "string" ? data.artist : undefined,
      title: typeof data.title === "string" ? data.title : undefined,
      creator: typeof data.creator === "string" ? data.creator : undefined,
      coverUrl:
        typeof data.coverUrl === "string"
          ? data.coverUrl
          : data.coverUrl === null
            ? null
            : undefined,
      queuedAfter,
    };
  }
  if (t === "queue_sync") {
    return {
      type: "queue_sync",
      v: PARTY_PROTOCOL_VERSION,
      queued: parseQueued(data.queued),
      seq: typeof data.seq === "number" ? data.seq : 0,
    };
  }
  if (t === "lobby_chat") {
    const ts = Number(data.ts);
    if (!Number.isFinite(ts)) return null;
    const memberId = typeof data.memberId === "string" ? data.memberId : "";
    const text = typeof data.text === "string" ? data.text : "";
    if (!memberId || !text) return null;
    return {
      type: "lobby_chat",
      v: PARTY_PROTOCOL_VERSION,
      memberId,
      text,
      ts,
    };
  }
  return null;
}

function parseMembers(v: unknown): PartyMemberWire[] {
  if (!Array.isArray(v)) return [];
  const out: PartyMemberWire[] = [];
  for (const x of v) {
    if (!isRecord(x)) continue;
    const id = typeof x.id === "string" ? x.id : "";
    const displayName = typeof x.displayName === "string" ? x.displayName : "";
    if (id) out.push({ id, displayName: displayName || "Player" });
  }
  return out;
}

function parseQueued(v: unknown): QueuedBeatmapWire[] {
  if (!Array.isArray(v)) return [];
  const out: QueuedBeatmapWire[] = [];
  for (const x of v) {
    if (!isRecord(x)) continue;
    const setId = Number(x.setId);
    if (!Number.isFinite(setId)) continue;
    out.push({
      seq: typeof x.seq === "number" ? x.seq : 0,
      setId,
      noVideo: Boolean(x.noVideo),
      artist: typeof x.artist === "string" ? x.artist : undefined,
      title: typeof x.title === "string" ? x.title : undefined,
      creator: typeof x.creator === "string" ? x.creator : undefined,
      coverUrl:
        typeof x.coverUrl === "string"
          ? x.coverUrl
          : x.coverUrl === null
            ? null
            : undefined,
      fromMemberId: typeof x.fromMemberId === "string" ? x.fromMemberId : "",
    });
  }
  return out;
}

function parseChatTail(v: unknown): LobbyChatWire[] {
  if (!Array.isArray(v)) return [];
  const out: LobbyChatWire[] = [];
  for (const x of v) {
    if (!isRecord(x)) continue;
    const memberId = typeof x.memberId === "string" ? x.memberId : "";
    const text = typeof x.text === "string" ? x.text : "";
    const ts = Number(x.ts);
    if (!memberId || !text || !Number.isFinite(ts)) continue;
    out.push({ memberId, text, ts });
  }
  return out;
}

export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}
