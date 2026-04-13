import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ClipboardPaste,
  Copy,
  Crown,
  Hash,
  ListMusic,
  Loader2,
  LogOut,
  MessageCircle,
  UserRound,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { PARTY_SERVER_URL_UI_HIDDEN } from "./constants";
import type { PartyClientState } from "./party/partyClient";
import type { QueuedBeatmapWire } from "./party/protocol";

type PartyConnectionState = PartyClientState["connection"];

function partyWsHostLabel(url: string): string {
  const t = url.trim();
  if (!t) return "—";
  try {
    return new URL(t).host;
  } catch {
    return t;
  }
}

function queueItemLabel(q: QueuedBeatmapWire): string {
  if (q.title && q.artist) return `${q.artist} – ${q.title}`;
  return `Set #${q.setId}`;
}

function formatChatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function displayInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function ConnectionGlyph({ state }: { state: PartyConnectionState }) {
  if (state === "connecting") {
    return <Loader2 className="party-conn-glyph party-conn-glyph--spin" aria-hidden />;
  }
  if (state === "connected") {
    return <Wifi className="party-conn-glyph" aria-hidden />;
  }
  return <WifiOff className="party-conn-glyph" aria-hidden />;
}

export function PartyPanel({
  partyState,
  displayName,
  joinCodeDraft,
  partyUrlDraft,
  onDisplayNameChange,
  onJoinCodeChange,
  onPartyUrlChange,
  publicPartyUrl,
  onConnect,
  onDisconnect,
  onCreateLobby,
  onJoinLobby,
  onJoinFromClipboard,
  onLeaveLobby,
  onCopyCode,
  onSendChat,
  onTransferLeadership,
  onClearQueue,
  onRemoveQueueItem,
}: {
  partyState: PartyClientState;
  displayName: string;
  joinCodeDraft: string;
  partyUrlDraft: string;
  onDisplayNameChange: (v: string) => void;
  onJoinCodeChange: (v: string) => void;
  onPartyUrlChange: (v: string) => void;
  publicPartyUrl: string | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onCreateLobby: () => void;
  onJoinLobby: () => void;
  onJoinFromClipboard: () => void;
  onLeaveLobby: () => void;
  onCopyCode: () => void;
  onSendChat: (text: string) => void;
  onTransferLeadership: (targetMemberId: string) => void;
  onClearQueue: () => void;
  onRemoveQueueItem: (seq: number) => void;
}) {
  const { connection, lastError, lobbyCode, leaderId, members, selfId, queuedMaps, chat } = partyState;
  const inLobby = Boolean(lobbyCode && selfId);
  const isLeader = Boolean(selfId && leaderId === selfId);
  const connLabel: Record<PartyConnectionState, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting…",
    connected: "Connected to server",
    error: "Connection error",
  };

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members) m.set(x.id, x.displayName);
    return m;
  }, [members]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [transferTarget, setTransferTarget] = useState("");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  const submitChat = (e: FormEvent) => {
    e.preventDefault();
    const t = chatDraft.trim();
    if (!t) return;
    onSendChat(t);
    setChatDraft("");
  };

  const others = members.filter((m) => m.id !== selfId);

  return (
    <div className="panel panel-elevated party-panel-root">
      <section className="party-conn-strip" role="status" aria-live="polite">
        <div className={`party-conn-strip-inner party-conn-strip--${connection}`}>
          <div className="party-conn-strip-icon" aria-hidden>
            <ConnectionGlyph state={connection} />
          </div>
          <div className="party-conn-strip-body">
            <h2 className="party-conn-strip-title">{connLabel[connection]}</h2>
            <p className="party-conn-strip-host" title={partyState.url || undefined}>
              {partyWsHostLabel(partyState.url)}
            </p>
          </div>
          {connection === "connected" && (
            <div className="party-conn-strip-meta">
              {inLobby ? (
                <span className="party-mini-pill party-mini-pill--live">
                  <Users size={13} strokeWidth={2.25} aria-hidden />
                  In lobby · {members.length}
                </span>
              ) : (
                <span className="party-mini-pill">Not in a lobby</span>
              )}
            </div>
          )}
        </div>
        {(connection === "disconnected" || connection === "error") && (
          <button type="button" className="primary party-conn-strip-cta" onClick={onConnect}>
            {connection === "error" || lastError ? "Reconnect to server" : "Connect to server"}
          </button>
        )}
      </section>

      {!publicPartyUrl && (
        <div className="party-online-cta party-online-manual party-section-gap-sm">
          <div className="party-online-title">Remote play</div>
          <p className="hint u-mt-0" title="See project docs for hosting a wss:// party server.">
            Paste a <code>wss://</code> URL below.
          </p>
        </div>
      )}

      <section className="party-setup-card" aria-label="Server and display name">
        {!PARTY_SERVER_URL_UI_HIDDEN && (
          <label className="field">
            <span className="party-field-label">
              <Wifi size={14} strokeWidth={2.25} aria-hidden />
              Party server WebSocket URL
            </span>
            <input
              type="text"
              autoComplete="off"
              placeholder="wss://your-party-host.example.com"
              value={partyUrlDraft}
              onChange={(e) => onPartyUrlChange(e.target.value)}
              disabled={connection === "connecting" || inLobby}
            />
          </label>
        )}
        <label className="field">
          <span className="party-field-label">
            <UserRound size={14} strokeWidth={2.25} aria-hidden />
            Display name
          </span>
          <input
            type="text"
            autoComplete="off"
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            disabled={inLobby}
            placeholder="How others see you"
          />
        </label>
      </section>

      {(connection === "connected" || connection === "connecting") && (
        <div className="party-setup-actions">
          <button
            type="button"
            className="secondary party-setup-disconnect"
            onClick={onDisconnect}
            disabled={connection === "connecting"}
          >
            Disconnect from server
          </button>
        </div>
      )}

      {lastError && <div className="error-banner party-section-gap-sm">{lastError}</div>}

      {PARTY_SERVER_URL_UI_HIDDEN &&
        connection === "error" &&
        lastError?.includes("before handshake") && (
          <div className="party-troubleshoot hint party-section-gap-sm">
            Same-network issues are often router hairpin/NAT — try a LAN or <code>ws://</code> URL, or see project docs.
          </div>
        )}

      {connection === "connected" && !inLobby && (
        <section className="party-pre-lobby party-section-gap" aria-label="Create or join a lobby">
          <h2 className="party-pre-lobby-heading">Start or join a session</h2>
          <p className="party-pre-lobby-lead hint">Host a new room, or enter a code someone shared with you.</p>
          <div className="party-pre-lobby-grid">
            <article className="party-action-card party-action-card--host">
              <div className="party-action-card-head">
                <span className="party-action-icon party-action-icon--host" aria-hidden>
                  <Crown size={22} strokeWidth={2} />
                </span>
                <div>
                  <h3 className="party-action-title">Host</h3>
                  <p className="party-action-desc">Create a lobby and share the code.</p>
                </div>
              </div>
              <button type="button" className="primary party-action-cta" onClick={onCreateLobby}>
                Create lobby
              </button>
            </article>

            <article className="party-action-card party-action-card--join">
              <div className="party-action-card-head">
                <span className="party-action-icon party-action-icon--join" aria-hidden>
                  <Hash size={22} strokeWidth={2} />
                </span>
                <div>
                  <h3 className="party-action-title">Join</h3>
                  <p className="party-action-desc">Enter a lobby code to connect.</p>
                </div>
              </div>
              <label className="field party-field-tight">
                <span>Lobby code</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. ABC123"
                  value={joinCodeDraft}
                  onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
                />
              </label>
              <div className="party-join-actions">
                <button type="button" className="primary" onClick={onJoinLobby}>
                  Join lobby
                </button>
                <button type="button" className="secondary party-join-clipboard" onClick={onJoinFromClipboard}>
                  <ClipboardPaste size={16} strokeWidth={2.25} aria-hidden />
                  From clipboard
                </button>
              </div>
            </article>
          </div>
        </section>
      )}

      {inLobby && lobbyCode && (
        <div className="party-in-lobby party-section-gap">
          <div className="party-lobby-hero">
            <div className="party-lobby-hero-glow" aria-hidden />
            <div className="party-lobby-hero-inner">
              <span className="party-lobby-eyebrow">Lobby code</span>
              <div className="party-lobby-code-row">
                <code className="party-lobby-code">{lobbyCode}</code>
                <button type="button" className="secondary party-btn-with-icon" onClick={onCopyCode}>
                  <Copy size={16} strokeWidth={2.25} aria-hidden />
                  Copy
                </button>
              </div>
              <div className="party-lobby-pills">
                <span className="party-pill">
                  <Users size={14} strokeWidth={2.25} aria-hidden />
                  {members.length} in party
                </span>
                {isLeader ? (
                  <span className="party-pill party-pill--accent">
                    <Crown size={14} strokeWidth={2.25} aria-hidden />
                    You’re the leader
                  </span>
                ) : (
                  <span className="party-pill party-pill--muted">
                    <UserRound size={14} strokeWidth={2.25} aria-hidden />
                    Member
                  </span>
                )}
              </div>
            </div>
          </div>

          <p
            className="party-role-hint"
            title={isLeader ? "Queue maps from Search or Collections." : "Leader controls the queue."}
          >
            {isLeader
              ? "Queue beatmaps from Search or Collections — everyone sees the list here."
              : "Hang tight — the leader picks maps for the group."}
          </p>

          <div className="party-roster party-roster--cards">
            <div className="party-roster-head">
              <Users size={16} strokeWidth={2.25} aria-hidden />
              <span className="party-roster-head-text">Players</span>
              <span className="party-roster-count">{members.length}</span>
            </div>
            <ul className="party-roster-list">
              {members.map((m) => (
                <li key={m.id} className="party-roster-item">
                  <span className="party-roster-avatar" aria-hidden>
                    {displayInitials(m.displayName)}
                  </span>
                  <div className="party-roster-item-main">
                    <span className="party-roster-name">{m.displayName}</span>
                    <span className="party-roster-badges">
                      {m.id === leaderId && (
                        <span className="party-badge-leader">
                          <Crown size={10} strokeWidth={2.5} aria-hidden />
                          Leader
                        </span>
                      )}
                      {m.id === selfId && <span className="party-badge-you">You</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="party-lobby-split">
            <section className="party-queue-card" aria-label="Beatmap queue">
              <div className="party-section-head">
                <h3 className="party-section-title">
                  <ListMusic size={15} strokeWidth={2.25} className="party-section-title-icon" aria-hidden />
                  Beatmap queue
                </h3>
                {isLeader && queuedMaps.length > 0 && (
                  <button type="button" className="secondary party-queue-clear" onClick={onClearQueue}>
                    Clear all
                  </button>
                )}
              </div>
              {queuedMaps.length === 0 ? (
                <p className="hint party-queue-empty">No maps queued yet.</p>
              ) : (
                <ul className="party-queue-list">
                  {queuedMaps.map((q) => (
                    <li key={q.seq} className="party-queue-item">
                      {q.coverUrl ? (
                        <img className="party-queue-thumb" src={q.coverUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="party-queue-thumb party-queue-thumb--placeholder" aria-hidden />
                      )}
                      <div className="party-queue-meta">
                        <div className="party-queue-title">{queueItemLabel(q)}</div>
                        <div className="party-queue-sub">
                          Set {q.setId}
                          {q.noVideo ? " · no video" : ""}
                          {" · "}
                          {nameById.get(q.fromMemberId) ?? "Player"}
                        </div>
                      </div>
                      {isLeader && (
                        <button
                          type="button"
                          className="secondary party-queue-remove"
                          onClick={() => onRemoveQueueItem(q.seq)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="party-chat-card" aria-label="Lobby chat">
              <h3 className="party-section-title">
                <MessageCircle size={15} strokeWidth={2.25} className="party-section-title-icon" aria-hidden />
                Lobby chat
              </h3>
              <div className="party-chat-log" role="log" aria-live="polite">
                {chat.length === 0 ? (
                  <p className="hint party-chat-empty">No messages yet. Say hi.</p>
                ) : (
                  chat.map((line, i) => (
                    <div
                      key={`${line.ts}-${i}`}
                      className={`party-chat-line${line.memberId === selfId ? " party-chat-line--self" : ""}`}
                    >
                      <div className="party-chat-line-head">
                        <span className="party-chat-name">{nameById.get(line.memberId) ?? "Player"}</span>
                        <span className="party-chat-time">{formatChatTime(line.ts)}</span>
                      </div>
                      <div className="party-chat-text">{line.text}</div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
              <form className="party-chat-form" onSubmit={submitChat}>
                <input
                  type="text"
                  className="party-chat-input"
                  placeholder="Message the lobby…"
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  autoComplete="off"
                  maxLength={280}
                  disabled={connection !== "connected"}
                />
                <button
                  type="submit"
                  className="primary"
                  disabled={connection !== "connected" || chatDraft.trim() === ""}
                >
                  Send
                </button>
              </form>
            </section>
          </div>

          {isLeader && others.length > 0 && (
            <div className="party-transfer-card">
              <span className="party-transfer-label">Transfer leadership</span>
              <div className="party-transfer-row">
                <select
                  className="party-transfer-select"
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  aria-label="Player to promote"
                >
                  <option value="">Choose player…</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary"
                  disabled={!transferTarget}
                  onClick={() => {
                    if (!transferTarget) return;
                    onTransferLeadership(transferTarget);
                    setTransferTarget("");
                  }}
                >
                  Transfer
                </button>
              </div>
            </div>
          )}

          <button type="button" className="danger party-leave-btn" onClick={onLeaveLobby}>
            <LogOut size={17} strokeWidth={2.25} aria-hidden />
            Leave lobby
          </button>
        </div>
      )}
    </div>
  );
}
