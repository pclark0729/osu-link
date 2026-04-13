import type { Dispatch, SetStateAction } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { saveDesktopNotificationsEnabled } from "./desktopNotify";
import {
  DEFAULT_HOTKEY_FOCUS_SEARCH,
  DEFAULT_HOTKEY_RANDOM_CURATE,
  DEFAULT_HOTKEY_TRAIN_END,
  DEFAULT_HOTKEY_TRAIN_OPEN,
  DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
  DEFAULT_PARTY_WS_URL,
  PARTY_SERVER_URL_UI_HIDDEN,
  PUBLIC_PARTY_WS_URL,
} from "./constants";
import { resolveSocialApiBaseUrl } from "./socialApiUrl";

export type SettingsPanelState = {
  clientId: string;
  clientSecret: string;
  beatmapDirectory: string | null;
  onboardingCompleted: boolean;
  partyServerUrl: string | null;
  socialApiBaseUrl: string | null;
  hotkeyFocusSearch: string;
  hotkeyRandomCurate: string;
  hotkeyTrainOpen: string;
  hotkeyTrainRandomize: string;
  hotkeyTrainEnd: string;
  discordControlEnabled: boolean;
  discordControlSessionToken: string | null;
  discordControlWsUrl: string | null;
  uiSoundEffectsEnabled: boolean;
};

export function SettingsPanel({
  appVersion,
  settings,
  setSettings,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
  updateBusy,
  handleCheckForUpdates,
  updaterAvailable: updaterOk,
  openSetupGuide,
  saveSettings,
  login,
  logout,
  settingsMsg,
  resolvedSongs,
  localBeatmapsetCount,
  refreshPaths,
  discordPairingCode,
  copyDiscordPairingCode,
  discordPairingBusy,
  startDiscordPairing,
  revokeDiscordControl,
  discordRemote,
  discordWsConnected,
}: {
  appVersion: string;
  settings: SettingsPanelState;
  setSettings: Dispatch<SetStateAction<SettingsPanelState>>;
  desktopNotificationsEnabled: boolean;
  setDesktopNotificationsEnabled: (v: boolean) => void;
  updateBusy: boolean;
  handleCheckForUpdates: () => void | Promise<void>;
  updaterAvailable: () => boolean;
  openSetupGuide: () => void | Promise<void>;
  saveSettings: () => void | Promise<void>;
  login: () => void | Promise<void>;
  logout: () => void | Promise<void>;
  settingsMsg: string | null;
  resolvedSongs: string;
  localBeatmapsetCount: number;
  refreshPaths: () => void | Promise<void>;
  discordPairingCode: string | null;
  copyDiscordPairingCode: () => void | Promise<void>;
  discordPairingBusy: boolean;
  startDiscordPairing: () => void | Promise<void>;
  revokeDiscordControl: () => void | Promise<void>;
  discordRemote: { linked: boolean; discordUserId?: string; online?: boolean } | null;
  discordWsConnected: boolean;
}) {
  const resolvedApi = resolveSocialApiBaseUrl(settings.partyServerUrl, settings.socialApiBaseUrl);

  return (
    <div className="panel panel-elevated settings-panel">
      <p className="panel-sub">
        v<strong>{appVersion}</strong>
      </p>

      <details className="settings-disclosure">
        <summary>Keyboard shortcuts</summary>
        <div className="settings-disclosure-body">
          <p className="hint settings-shortcuts-hint">
            <strong>This window:</strong> Alt+1–9 switch tabs (Search → … → Settings).
          </p>
          {isTauri() && (
            <>
              <p className="hint u-mb-3">
                <strong>Global:</strong> work in background.{" "}
                <a href="https://v2.tauri.app/plugin/global-shortcut/" target="_blank" rel="noreferrer">
                  Tauri syntax
                </a>
                . Empty = off.
              </p>
              <div className="grid-2">
                <label className="field">
                  <span>Focus &amp; search</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder={DEFAULT_HOTKEY_FOCUS_SEARCH}
                    value={settings.hotkeyFocusSearch}
                    onChange={(e) => setSettings({ ...settings, hotkeyFocusSearch: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Random curate</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder={DEFAULT_HOTKEY_RANDOM_CURATE}
                    value={settings.hotkeyRandomCurate}
                    onChange={(e) => setSettings({ ...settings, hotkeyRandomCurate: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Train: open in osu!</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder={DEFAULT_HOTKEY_TRAIN_OPEN}
                    value={settings.hotkeyTrainOpen}
                    onChange={(e) => setSettings({ ...settings, hotkeyTrainOpen: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Train: randomize</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder={DEFAULT_HOTKEY_TRAIN_RANDOMIZE}
                    value={settings.hotkeyTrainRandomize}
                    onChange={(e) => setSettings({ ...settings, hotkeyTrainRandomize: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Train: end session</span>
                  <input
                    type="text"
                    autoComplete="off"
                    placeholder={DEFAULT_HOTKEY_TRAIN_END}
                    value={settings.hotkeyTrainEnd}
                    onChange={(e) => setSettings({ ...settings, hotkeyTrainEnd: e.target.value })}
                  />
                </label>
              </div>
              <div className="row-actions row-actions--spaced u-mt-3">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setSettings((s) => ({
                      ...s,
                      hotkeyFocusSearch: "",
                      hotkeyRandomCurate: "",
                      hotkeyTrainOpen: "",
                      hotkeyTrainRandomize: "",
                      hotkeyTrainEnd: "",
                    }))
                  }
                >
                  Clear global hotkeys
                </button>
              </div>
            </>
          )}
        </div>
      </details>

      <details className="settings-disclosure" open>
        <summary>Updates</summary>
        <div className="settings-disclosure-body">
          <div className="row-actions row-actions--spaced">
            <button
              type="button"
              className="secondary"
              disabled={!updaterOk() || updateBusy}
              aria-busy={updateBusy}
              onClick={() => void handleCheckForUpdates()}
            >
              {updateBusy ? "Checking…" : "Check for updates"}
            </button>
          </div>
          {!updaterOk() && <p className="hint u-mb-0">Desktop install only (not dev / browser).</p>}
        </div>
      </details>

      {isTauri() && (
        <details className="settings-disclosure" open>
          <summary>Notifications</summary>
          <div className="settings-disclosure-body">
            <label className="field field--checkbox u-mb-3">
              <input
                type="checkbox"
                checked={desktopNotificationsEnabled}
                onChange={(e) => {
                  const v = e.target.checked;
                  saveDesktopNotificationsEnabled(v);
                  setDesktopNotificationsEnabled(v);
                }}
              />
              <span>Party queue &amp; friend requests</span>
            </label>
            <p className="hint u-mb-0" title="First time, your OS may prompt for permission.">
              Uses system notifications.
            </p>
          </div>
        </details>
      )}

      <details className="settings-disclosure" open>
        <summary>Sound</summary>
        <div className="settings-disclosure-body">
          <label className="field field--checkbox u-mb-0">
            <input
              type="checkbox"
              checked={settings.uiSoundEffectsEnabled}
              onChange={(e) =>
                setSettings({ ...settings, uiSoundEffectsEnabled: e.target.checked })
              }
            />
            <span>Thocky keyboard sounds (clicks &amp; typing)</span>
          </label>
          <p className="hint u-mb-0">
            Short mechanical-style feedback for buttons and text fields. Saved with{" "}
            <strong>Save settings</strong>.
          </p>
        </div>
      </details>

      <details className="settings-disclosure" open>
        <summary>OAuth</summary>
        <div className="settings-disclosure-body">
          <p className="panel-sub panel-sub--flush-top">Keys for search API. Downloads use a mirror.</p>
          <div className="row-actions row-actions--spaced">
            <button type="button" className="secondary" onClick={() => void openSetupGuide()}>
              Setup wizard
            </button>
          </div>
          <details className="settings-disclosure settings-disclosure--nested">
            <summary>Redirect URI (osu! OAuth app)</summary>
            <div className="settings-disclosure-body">
              <p className="hint u-mb-0">
                Must be <code>http://127.0.0.1:42813/callback</code>. Close other osu-link windows before sign-in.
              </p>
            </div>
          </details>
          <div className="grid-2">
            <label className="field">
              <span>Client ID</span>
              <input
                type="text"
                autoComplete="off"
                value={settings.clientId}
                onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Client secret</span>
              <input
                type="password"
                autoComplete="off"
                value={settings.clientSecret}
                onChange={(e) => setSettings({ ...settings, clientSecret: e.target.value })}
              />
            </label>
          </div>
        </div>
      </details>

      <details className="settings-disclosure" open>
        <summary>Paths &amp; servers</summary>
        <div className="settings-disclosure-body">
          <label className="field">
            <span>Songs folder override</span>
            <input
              type="text"
              placeholder="Default from osu!.cfg"
              value={settings.beatmapDirectory ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  beatmapDirectory: e.target.value === "" ? null : e.target.value,
                })
              }
            />
          </label>
          {!PARTY_SERVER_URL_UI_HIDDEN && (
            <label className="field field--stack">
              <span>Party WebSocket URL</span>
              <input
                type="text"
                autoComplete="off"
                placeholder={PUBLIC_PARTY_WS_URL ?? DEFAULT_PARTY_WS_URL}
                value={settings.partyServerUrl ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    partyServerUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                  })
                }
              />
            </label>
          )}
          <label className="field field--stack">
            <span>Social API base URL</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="http://host:4681"
              value={settings.socialApiBaseUrl ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  socialApiBaseUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                })
              }
            />
          </label>
          <p className="hint">
            Resolved API: <code>{resolvedApi ?? "—"}</code> · HTTP often <code>:4681</code>
          </p>
          <details className="settings-disclosure settings-disclosure--nested">
            <summary>LAN / relay details</summary>
            <div className="settings-disclosure-body">
              <p className="hint u-mb-0">
                Pairing tries LAN discovery, then fallbacks including <code>http://192.168.1.43:4681</code>, then the public
                relay
                {PARTY_SERVER_URL_UI_HIDDEN ? " (WS field may be hidden in this build)." : "."} Leave Social API empty to use
                discovery. Use <code>http://127.0.0.1:4681</code> only if party-server runs on this PC.
              </p>
            </div>
          </details>
          <label className="field field--stack">
            <span>Discord control WebSocket</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="Default: …/control from Social API"
              value={settings.discordControlWsUrl ?? ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  discordControlWsUrl: e.target.value.trim() === "" ? null : e.target.value.trim(),
                })
              }
            />
          </label>
          <details className="settings-disclosure settings-disclosure--nested">
            <summary>Discord pairing notes</summary>
            <div className="settings-disclosure-body">
              <p className="hint u-mb-0">
                Uses Party + Social fields immediately (no Save first). Prefer plain <code>http://</code> to your Pi unless
                TLS terminates there.
              </p>
            </div>
          </details>
          {discordPairingCode && (
            <div className="discord-pairing-code-block">
              <div className="party-code-row discord-pairing-code-row">
                <span className="party-code-label">Pairing code</span>
                <code className="party-code-value discord-pairing-code-value" aria-label="Discord pairing code">
                  {discordPairingCode}
                </code>
                <button type="button" className="secondary" onClick={() => void copyDiscordPairingCode()}>
                  Copy
                </button>
              </div>
              <p className="hint discord-pairing-code-hint u-mb-0">
                In Discord: <code>/osulink link</code> · ~15 min
              </p>
            </div>
          )}
          {settings.discordControlSessionToken && (
            <p className="hint">
              {discordRemote?.linked ? `Linked (${discordRemote.discordUserId ?? "?"})` : "Awaiting Discord"} · session{" "}
              {discordWsConnected ? "on" : "off"}
              {discordRemote?.online != null && ` · relay sees desktop ${discordRemote.online ? "online" : "offline"}`}
            </p>
          )}
          {!isTauri() && (
            <p className="hint" role="status">
              Discord control: desktop app only.
            </p>
          )}
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              disabled={!isTauri() || discordPairingBusy}
              aria-busy={discordPairingBusy}
              onClick={() => void startDiscordPairing()}
            >
              {discordPairingBusy ? "…" : "Discord pairing"}
            </button>
            <button
              type="button"
              className="danger"
              disabled={!isTauri() || discordPairingBusy}
              onClick={() => void revokeDiscordControl()}
            >
              Revoke Discord
            </button>
          </div>
          {discordPairingBusy && (
            <p className="hint u-mb-0" aria-live="polite">
              Requesting code…
            </p>
          )}
          <p className="hint">
            Songs: {resolvedSongs || "—"} · <strong>{localBeatmapsetCount}</strong> sets
          </p>
          <div className="row-actions">
            <button type="button" className="secondary" disabled={!isTauri()} onClick={() => void refreshPaths()}>
              Rescan Songs
            </button>
          </div>
          <p className="hint u-mb-0" title="After changing OAuth scopes, sign in again. Social features need party HTTP reachable.">
            Re-login after scope changes.
          </p>
        </div>
      </details>

      <details className="settings-disclosure" open>
        <summary>Account</summary>
        <div className="settings-disclosure-body">
          <div className="settings-danger-zone">
            <p className="settings-danger-zone-title">Session</p>
            <div className="row-actions">
              <button type="button" className="primary" onClick={() => void saveSettings()}>
                Save
              </button>
              <button type="button" className="secondary" onClick={() => void login()}>
                Sign in
              </button>
              <button type="button" className="danger" onClick={() => void logout()}>
                Sign out
              </button>
            </div>
            <p className="hint settings-danger-zone-hint">Sign out clears local session. Save persists keys and paths.</p>
          </div>
          {settingsMsg && <p className="hint">{settingsMsg}</p>}
        </div>
      </details>
    </div>
  );
}
