/** Wire format version for osu-link party lobbies. Bump when breaking. */
export const PARTY_PROTOCOL_VERSION = 1 as const;

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
  | { type: "leave_lobby"; v: typeof PARTY_PROTOCOL_VERSION };

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
    if (!selfId || !lobbyCode) return null;
    return {
      type: "welcome",
      v: PARTY_PROTOCOL_VERSION,
      selfId,
      lobbyCode,
      leaderId,
      members,
      queued,
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

export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}
