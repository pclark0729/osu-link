import { NeuSelect } from "../NeuSelect";
import { MODE_OPTIONS } from "./statsConstants";

export function StatsHero({
  username,
  usernamePlaceholder,
  avatarUrl,
  mode,
  disabled,
  busy,
  loadErr,
  onModeChange,
  onRefresh,
}: {
  username: string | null;
  usernamePlaceholder: string;
  avatarUrl: string | null;
  mode: string;
  disabled: boolean;
  busy: boolean;
  loadErr: string | null;
  onModeChange: (v: string) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="stats-hero">
      <div className="stats-hero-row">
        <div className="stats-hero-text">
          {username ? (
            <p className="stats-username">{username}</p>
          ) : (
            <p className="hint stats-username-placeholder">{usernamePlaceholder}</p>
          )}
        </div>
        {avatarUrl ? <img className="stats-avatar" src={avatarUrl} alt="" width={64} height={64} /> : null}
      </div>

      <div className="grid-2 stats-toolbar-grid">
        <label className="field">
          <span>Ruleset</span>
          <NeuSelect value={mode} disabled={disabled} options={MODE_OPTIONS} onChange={onModeChange} />
        </label>
        <div className="stats-toolbar-actions">
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={onRefresh}
            title="Uses the official osu! API. Each refresh loads cross-mode PP for all rulesets."
          >
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
      {loadErr ? <p className="hint stats-err">{loadErr}</p> : null}
    </header>
  );
}
