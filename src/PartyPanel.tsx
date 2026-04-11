import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
      <div className="panel-head">
        <h2>Party lobbies</h2>
        <p className="panel-sub">
          {PARTY_SERVER_URL_UI_HIDDEN ? (
            <>Connect, then create or join with a <strong>lobby code</strong>.</>
          ) : (
            <>Same <strong>server URL</strong> for everyone; join with a <strong>lobby code</strong>.</>
          )}
        </p>
      </div>

      <div className="party-server-status" role="status" aria-live="polite">
        <div className="party-server-status-title">Server status</div>
        <dl className="party-server-status-grid">
          <dt>Host</dt>
          <dd>{partyWsHostLabel(partyState.url)}</dd>
          <dt>Your connection</dt>
          <dd>
            <span className={`party-conn-badge party-conn-${connection}`}>{connLabel[connection]}</span>
          </dd>
          {connection === "connected" && (
            <>
              <dt>Lobby</dt>
              <dd>
                {inLobby ? (
                  <>
                    <code className="party-status-code">{lobbyCode}</code>
                    <span className="party-status-meta"> · {members.length} players</span>
                  </>
                ) : (
                  "Not in a lobby"
                )}
              </dd>
            </>
          )}
        </dl>
        {(connection === "disconnected" || connection === "error") && (
          <div className="party-server-status-actions">
            <button type="button" className="primary party-status-reconnect" onClick={onConnect}>
              {connection === "error" || lastError ? "Reconnect to server" : "Connect to server"}
            </button>
          </div>
        )}
      </div>

      {!publicPartyUrl && (
        <div className="party-online-cta party-online-manual">
          <div className="party-online-title">Remote play</div>
          <p className="hint u-mt-0">
            Host a <code>wss://</code> party server and paste its URL below (see project docs).
          </p>
        </div>
      )}

      {!PARTY_SERVER_URL_UI_HIDDEN && (
        <label className="field">
          <span>Party server WebSocket URL</span>
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
        <span>Display name</span>
        <input
          type="text"
          autoComplete="off"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          disabled={inLobby}
          placeholder="Player"
        />
      </label>

      {(connection === "connected" || connection === "connecting") && (
        <div className="row-actions row-actions--wrap">
          <button
            type="button"
            className="secondary"
            onClick={onDisconnect}
            disabled={connection === "connecting"}
          >
            Disconnect
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
        <>
          <div className="grid-2 party-section-gap">
            <div>
              <p className="hint u-mt-0">
                <strong>Create</strong> a lobby and share the code.
              </p>
              <button type="button" className="primary" onClick={onCreateLobby}>
                Create lobby
              </button>
            </div>
            <div>
              <label className="field">
                <span>Join code</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. ABC123"
                  value={joinCodeDraft}
                  onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
                />
              </label>
              <div className="row-actions row-actions--wrap-tight">
                <button type="button" className="secondary" onClick={onJoinLobby}>
                  Join lobby
                </button>
                <button type="button" className="secondary" onClick={onJoinFromClipboard}>
                  Join from clipboard
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {inLobby && lobbyCode && (
        <div className="party-in-lobby party-section-gap">
          <div className="party-code-row">
            <span className="party-code-label">Lobby code</span>
            <code className="party-code-value">{lobbyCode}</code>
            <button type="button" className="secondary" onClick={onCopyCode}>
              Copy
            </button>
          </div>
          <p className="hint">
            {isLeader
              ? "Leader: use Send to party from Search/Collections, or manage the queue below."
              : "Waiting for the leader. Imports use your Songs folder and download options."}
          </p>

          <div className="party-lobby-split">
            <section className="party-queue-card" aria-label="Beatmap queue">
              <div className="party-section-head">
                <h3 className="party-section-title">Beatmap queue</h3>
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
              <h3 className="party-section-title">Lobby chat</h3>
              <div className="party-chat-log" role="log" aria-live="polite">
                {chat.length === 0 ? (
                  <p className="hint party-chat-empty">No messages yet. Say hi.</p>
                ) : (
                  chat.map((line, i) => (
                    <div key={`${line.ts}-${i}`} className="party-chat-line">
                      <div className="party-chat-line-head">
                        <span className="party-chat-time">{formatChatTime(line.ts)}</span>
                        <span className="party-chat-name">{nameById.get(line.memberId) ?? "Player"}</span>
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
                <button type="submit" className="primary" disabled={connection !== "connected" || chatDraft.trim() === ""}>
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

          <div className="party-roster">
            <div className="party-roster-title">Players ({members.length})</div>
            <ul className="party-roster-list">
              {members.map((m) => (
                <li key={m.id}>
                  <span className="party-roster-name">{m.displayName}</span>
                  {m.id === leaderId && <span className="party-badge-leader">Leader</span>}
                  {m.id === selfId && <span className="party-badge-you">You</span>}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" className="danger" onClick={onLeaveLobby}>
            Leave lobby
          </button>
        </div>
      )}
    </div>
  );
}
