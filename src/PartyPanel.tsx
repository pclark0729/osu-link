import type { PartyClientState } from "./party/partyClient";

type PartyConnectionState = PartyClientState["connection"];

export function PartyPanel({
  partyState,
  displayName,
  joinCodeDraft,
  partyUrlDraft,
  desktop,
  localPartyBusy,
  onDisplayNameChange,
  onJoinCodeChange,
  onPartyUrlChange,
   onCreateLocalParty,
  publicPartyUrl,
  onUsePublicPartyServer,
  onConnect,
  onDisconnect,
  onCreateLobby,
  onJoinLobby,
  onLeaveLobby,
  onCopyCode,
}: {
  partyState: PartyClientState;
  displayName: string;
  joinCodeDraft: string;
  partyUrlDraft: string;
  desktop: boolean;
  localPartyBusy: boolean;
  onDisplayNameChange: (v: string) => void;
  onJoinCodeChange: (v: string) => void;
  onPartyUrlChange: (v: string) => void;
  onCreateLocalParty: () => void;
  /** When set at build time, users can one-click switch to the shared internet party host. */
  publicPartyUrl: string | undefined;
  onUsePublicPartyServer: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onCreateLobby: () => void;
  onJoinLobby: () => void;
  onLeaveLobby: () => void;
  onCopyCode: () => void;
}) {
  const { connection, lastError, lobbyCode, leaderId, members, selfId } = partyState;
  const inLobby = Boolean(lobbyCode && selfId);
  const isLeader = Boolean(selfId && leaderId === selfId);
  const connLabel: Record<PartyConnectionState, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting…",
    connected: "Connected to server",
    error: "Connection error",
  };

  return (
    <div className="panel panel-elevated">
      <div className="panel-head">
        <h2>Party lobbies</h2>
        <p className="panel-sub">
          Everyone uses the same <strong>party server URL</strong> and a short <strong>lobby code</strong>. For friends
          across the internet, use a publicly reachable server (see online section below). The in-app server is only for
          this computer.
        </p>
      </div>

      {publicPartyUrl ? (
        <div className="party-online-cta">
          <div className="party-online-title">Play online (anywhere)</div>
          <p className="hint" style={{ marginTop: 0 }}>
            This build is configured with a shared party host. Use it so you and friends can connect from anywhere.
          </p>
          <button
            type="button"
            className="primary"
            disabled={partyState.connection === "connecting" || Boolean(partyState.lobbyCode && partyState.selfId)}
            onClick={onUsePublicPartyServer}
          >
            Use online party server
          </button>
          <p className="hint party-url-hint">
            Host: <code>{publicPartyUrl}</code>
          </p>
        </div>
      ) : (
        <div className="party-online-cta party-online-manual">
          <div className="party-online-title">Play online (anywhere)</div>
          <p className="hint" style={{ marginTop: 0 }}>
            To play with people far away, run <code>party-server</code> on a VPS or PaaS (see <code>Dockerfile</code> in{" "}
            <code>party-server/</code>), put it behind <code>wss://</code> with TLS, then paste that URL above — or
            distribute builds with <code>VITE_PUBLIC_PARTY_WS_URL</code> set to your <code>wss://…</code> endpoint.
          </p>
        </div>
      )}

      {desktop && (
        <div className="party-local-cta">
          <button
            type="button"
            className="primary"
            disabled={
              localPartyBusy ||
              partyState.connection === "connecting" ||
              Boolean(partyState.lobbyCode && partyState.selfId)
            }
            onClick={onCreateLocalParty}
          >
            {localPartyBusy ? "Starting…"
              : partyState.lobbyCode && partyState.selfId
                ? "Already in a lobby"
                : "Create party (local server)"}
          </button>
          <p className="hint" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
            Same-PC only: starts a server on <code>127.0.0.1</code>, connects, and shows your lobby code. Does not reach
            friends in other cities — use the online section above for that.
          </p>
        </div>
      )}

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
      <label className="field">
        <span>Your name in the lobby</span>
        <input
          type="text"
          autoComplete="off"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          disabled={inLobby}
          placeholder="Player"
        />
      </label>

      <div className="row-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        {connection === "disconnected" || connection === "error" ? (
          <button type="button" className="primary" onClick={onConnect}>
            Connect
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={onDisconnect}
            disabled={connection === "connecting"}
          >
            Disconnect
          </button>
        )}
        <span className={`party-conn-badge party-conn-${connection}`}>{connLabel[connection]}</span>
      </div>

      {lastError && <div className="error-banner" style={{ marginTop: "0.75rem" }}>{lastError}</div>}

      {connection === "connected" && !inLobby && (
        <>
          <div className="grid-2" style={{ marginTop: "1rem" }}>
            <div>
              <p className="hint" style={{ marginTop: 0 }}>
                <strong>Create</strong> a new lobby and share the code with friends.
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
              <button type="button" className="secondary" onClick={onJoinLobby}>
                Join lobby
              </button>
            </div>
          </div>
        </>
      )}

      {inLobby && lobbyCode && (
        <div className="party-in-lobby" style={{ marginTop: "1rem" }}>
          <div className="party-code-row">
            <span className="party-code-label">Lobby code</span>
            <code className="party-code-value">{lobbyCode}</code>
            <button type="button" className="secondary" onClick={onCopyCode}>
              Copy
            </button>
          </div>
          <p className="hint">
            {isLeader
              ? "You are the party leader — use “Send to party” on search or collection rows."
              : "Waiting for the leader to queue beatmaps. Imports use your Songs folder and download settings."}
          </p>
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
