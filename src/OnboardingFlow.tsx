import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_HOTKEY_FOCUS_SEARCH,
  DEFAULT_HOTKEY_RANDOM_CURATE,
  DEFAULT_HOTKEY_TRAIN_END,
  DEFAULT_HOTKEY_TRAIN_OPEN,
  DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
  OAUTH_REDIRECT_URI,
  OSU_OAUTH_LIST_URL,
  OSU_OAUTH_NEW_APP_URL,
} from "./constants";

const STEPS = ["Welcome", "osu! connection", "Beatmaps folder", "Finish"];

type Step = 0 | 1 | 2 | 3;

export function OnboardingFlow({
  onFinished,
  initialClientId,
  initialClientSecret,
  initialBeatmapDirectory,
  initialPartyServerUrl,
}: {
  onFinished: () => void;
  initialClientId?: string;
  initialClientSecret?: string;
  initialBeatmapDirectory?: string | null;
  initialPartyServerUrl?: string | null;
}) {
  const [step, setStep] = useState<Step>(0);
  const [clientId, setClientId] = useState(initialClientId ?? "");
  const [clientSecret, setClientSecret] = useState(initialClientSecret ?? "");
  const [beatmapOverride, setBeatmapOverride] = useState(
    initialBeatmapDirectory?.trim() ? initialBeatmapDirectory : "",
  );
  const [previewPath, setPreviewPath] = useState<string>("");
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPreviewPath = useCallback(async () => {
    try {
      const p = await invoke<string>("preview_beatmap_dir", {
        overridePath: beatmapOverride.trim() === "" ? null : beatmapOverride.trim(),
      });
      setPreviewPath(p);
    } catch {
      setPreviewPath("");
    }
  }, [beatmapOverride]);

  useEffect(() => {
    if (step === 2) {
      void refreshPreviewPath();
    }
  }, [step, refreshPreviewPath]);

  useEffect(() => {
    if (step !== 2) return;
    const t = window.setTimeout(() => void refreshPreviewPath(), 200);
    return () => window.clearTimeout(t);
  }, [beatmapOverride, step, refreshPreviewPath]);

  const copyRedirect = async () => {
    setCopyHint(null);
    try {
      await navigator.clipboard.writeText(OAUTH_REDIRECT_URI);
      setCopyHint("Copied to clipboard");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Select the URL above and copy manually (Ctrl+C)");
    }
  };

  const openNewApp = async () => {
    try {
      await openUrl(OSU_OAUTH_NEW_APP_URL);
    } catch {
      setError(`Open this link in your browser: ${OSU_OAUTH_NEW_APP_URL}`);
    }
  };

  const openAppList = async () => {
    try {
      await openUrl(OSU_OAUTH_LIST_URL);
    } catch {
      setError(`Open this link: ${OSU_OAUTH_LIST_URL}`);
    }
  };

  const canAdvanceFromOAuth = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  /** Empty override = use default path; non-empty override must resolve (preview_beatmap_dir). */
  const canAdvanceFromBeatmaps = beatmapOverride.trim() === "" || previewPath.trim() !== "";

  const finish = async () => {
    setError(null);
    setBusy(true);
    try {
      await invoke("save_settings_cmd", {
        s: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          beatmapDirectory: beatmapOverride.trim() === "" ? null : beatmapOverride.trim(),
          onboardingCompleted: false,
          partyServerUrl:
            initialPartyServerUrl && initialPartyServerUrl.trim() !== ""
              ? initialPartyServerUrl.trim()
              : null,
          socialApiBaseUrl: null,
          hotkeyFocusSearch: DEFAULT_HOTKEY_FOCUS_SEARCH,
          hotkeyRandomCurate: DEFAULT_HOTKEY_RANDOM_CURATE,
          hotkeyTrainOpen: DEFAULT_HOTKEY_TRAIN_OPEN,
          hotkeyTrainRandomize: DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
          hotkeyTrainEnd: DEFAULT_HOTKEY_TRAIN_END,
          discordControlEnabled: true,
          discordControlSessionToken: null,
          discordControlWsUrl: null,
          uiSoundEffectsEnabled: true,
        },
      });
      await invoke("oauth_login");
      await invoke("save_settings_cmd", {
        s: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          beatmapDirectory: beatmapOverride.trim() === "" ? null : beatmapOverride.trim(),
          onboardingCompleted: true,
          partyServerUrl:
            initialPartyServerUrl && initialPartyServerUrl.trim() !== ""
              ? initialPartyServerUrl.trim()
              : null,
          socialApiBaseUrl: null,
          hotkeyFocusSearch: DEFAULT_HOTKEY_FOCUS_SEARCH,
          hotkeyRandomCurate: DEFAULT_HOTKEY_RANDOM_CURATE,
          hotkeyTrainOpen: DEFAULT_HOTKEY_TRAIN_OPEN,
          hotkeyTrainRandomize: DEFAULT_HOTKEY_TRAIN_RANDOMIZE,
          hotkeyTrainEnd: DEFAULT_HOTKEY_TRAIN_END,
          discordControlEnabled: true,
          discordControlSessionToken: null,
          discordControlWsUrl: null,
          uiSoundEffectsEnabled: true,
        },
      });
      onFinished();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <h1>osu-link</h1>
          <p className="onboarding-tagline">Search &amp; import for osu! stable</p>
        </div>

        <nav className="onboarding-steps" aria-label="Setup steps">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`onboarding-step-pill ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="onboarding-step-num">{i + 1}</span>
              {label}
            </span>
          ))}
        </nav>

        {error && <div className="error-banner onboarding-error">{error}</div>}

        {step === 0 && (
          <div className="onboarding-body">
            <p>
              Uses the osu! API for search; maps install via mirror into your <strong>Songs</strong> folder.
            </p>
            <ul className="onboarding-list">
              <li>One osu! <strong>OAuth app</strong> (you create it).</li>
              <li>Browser sign-in — no password stored here.</li>
            </ul>
            <p className="hint">~1 min</p>
            <div className="onboarding-actions">
              <button type="button" className="primary" onClick={() => setStep(1)}>
                Start setup
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-body">
            <p>
              Create an <strong>OAuth app</strong> on osu! for API access.
            </p>

            <div className="onboarding-action-grid">
              <button type="button" className="primary" onClick={() => void openNewApp()}>
                New OAuth app (osu!)
              </button>
              <button type="button" className="secondary" onClick={() => void openAppList()}>
                Existing OAuth apps
              </button>
            </div>

            <div className="onboarding-redirect-box">
              <span className="field-label">Callback URL (paste on osu!)</span>
              <code className="onboarding-callback">{OAUTH_REDIRECT_URI}</code>
              <button type="button" className="secondary onboarding-copy" onClick={() => void copyRedirect()}>
                Copy URL
              </button>
              {copyHint && <p className="hint copy-hint">{copyHint}</p>}
            </div>

            <ol className="onboarding-mini-list">
              <li>Name the app (e.g. osu-link).</li>
              <li>Paste callback into <strong>Application callback URL</strong>.</li>
              <li>Copy <strong>Client ID</strong> and <strong>secret</strong> below.</li>
            </ol>

            <div className="grid-2">
              <label className="field">
                <span>Client ID</span>
                <input type="text" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From osu! OAuth" />
              </label>
              <label className="field">
                <span>Client secret</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Keep this private"
                />
              </label>
            </div>

            <details className="onboarding-details">
              <summary>Scopes &amp; port</summary>
              <p className="hint u-mb-0">
                Close other osu-link windows first. Port <strong>42813</strong>. Scopes: <code>public</code>,{" "}
                <code>identify</code>, <code>friends.read</code>.
              </p>
            </details>

            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="primary" disabled={!canAdvanceFromOAuth} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-body">
            <p>Imports go here:</p>
            <div className="onboarding-path-preview">
              <code>{previewPath || "…"}</code>
            </div>
            <label className="field">
              <span>Override Songs folder (optional)</span>
              <input
                type="text"
                placeholder="Empty = osu!.cfg / default"
                value={beatmapOverride}
                onChange={(e) => setBeatmapOverride(e.target.value)}
              />
            </label>
            <p className="hint" title="Leave blank for default Songs path from osu!. F5 in song select if a set is missing.">
              Blank = auto path
            </p>
            {!canAdvanceFromBeatmaps && beatmapOverride.trim() !== "" && (
              <p className="hint onboarding-path-error" role="alert">
                That folder path could not be resolved. Fix the path or clear the field to use the default Songs folder.
              </p>
            )}
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="primary" disabled={!canAdvanceFromBeatmaps} onClick={() => setStep(3)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-body">
            <p>
              <strong>Ready</strong> — saves keys, then browser sign-in.
            </p>
            <p className="hint" title="Configure party URL in Settings when you use Party or Social.">
              Party/Social: set server URL in Settings later.
            </p>
            <ul className="onboarding-list compact">
              <li>Client ID: {clientId.trim().slice(0, 6)}…</li>
              <li>Beatmaps: <code className="inline-code">{previewPath || "—"}</code></li>
            </ul>
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(2)} disabled={busy}>
                Back
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void finish()}>
                {busy ? "Connecting…" : "Save & connect osu!"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
