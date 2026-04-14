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
  OSU_SIGN_IN_URL,
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

  const openOsuSignIn = async () => {
    try {
      await openUrl(OSU_SIGN_IN_URL);
    } catch {
      setError(`Open this link: ${OSU_SIGN_IN_URL}`);
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
              You’ll do two things: create an osu! OAuth app, then sign in once so osu-link can use the osu! API.
            </p>
            <ul className="onboarding-list">
              <li>
                <strong>Create</strong> an OAuth app on osu! (takes ~30 seconds).
              </li>
              <li>
                <strong>Paste</strong> the callback URL + pick scopes (<code>public</code>, <code>identify</code>,{" "}
                <code>friends.read</code>).
              </li>
              <li>
                <strong>Copy</strong> the Client ID + Client secret into osu-link.
              </li>
              <li>
                <strong>Sign in</strong> in your browser (osu-link never sees your password).
              </li>
            </ul>
            <p className="hint">Most people finish in ~1 minute.</p>
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
              Step 1: open osu! account settings and create an <strong>OAuth app</strong>.
            </p>

            <div className="onboarding-action-grid">
              <button type="button" className="primary" onClick={() => void openNewApp()}>
                Open osu! OAuth settings
              </button>
              <button type="button" className="secondary" onClick={() => void openOsuSignIn()}>
                Sign in to osu!
              </button>
            </div>

            <p className="hint u-mb-0">
              Already made an app earlier?{" "}
              <button type="button" className="link-button" onClick={() => void openAppList()}>
                Open your OAuth apps list
              </button>
              .
            </p>

            <div className="onboarding-redirect-box">
              <span className="field-label">Callback URL (paste on osu!)</span>
              <code className="onboarding-callback">{OAUTH_REDIRECT_URI}</code>
              <button type="button" className="secondary onboarding-copy" onClick={() => void copyRedirect()}>
                Copy URL
              </button>
              {copyHint && <p className="hint copy-hint">{copyHint}</p>}
            </div>

            <ol className="onboarding-mini-list">
              <li>
                If you’re not signed in, sign in first (then come back here and click <strong>Open osu! OAuth settings</strong> again).
              </li>
              <li>
                On the osu! page, click <strong>New OAuth Application</strong>.
              </li>
              <li>
                Set <strong>Application name</strong> to something like <code>osu-link</code>.
              </li>
              <li>
                Paste the callback URL above into <strong>Application callback URL</strong>.
              </li>
              <li>
                Select scopes: <code>public</code>, <code>identify</code>, <code>friends.read</code>.
              </li>
              <li>
                Save, then copy the <strong>Client ID</strong> and <strong>Client secret</strong> into the fields below.
              </li>
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
              <summary>Troubleshooting</summary>
              <p className="hint u-mb-0">
                If sign-in fails later, close other osu-link windows first. The callback uses port{" "}
                <strong>42813</strong>.
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
            <p>
              Step 2: confirm where your <strong>osu! Songs</strong> folder is (this is where beatmaps get installed).
            </p>
            <div className="onboarding-path-preview">
              <code>{previewPath || "…"}</code>
            </div>
            <label className="field">
              <span>Songs folder override (optional)</span>
              <input
                type="text"
                placeholder="Leave empty to auto-detect from osu!"
                value={beatmapOverride}
                onChange={(e) => setBeatmapOverride(e.target.value)}
              />
            </label>
            <p
              className="hint"
              title="Leave blank to use the detected Songs path. After importing, press F5 in osu! song select if a set doesn’t appear immediately."
            >
              Leave it blank unless osu-link detects the wrong folder.
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
              <strong>Ready</strong> — next you’ll sign in via your browser and click <strong>Authorize</strong>.
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
