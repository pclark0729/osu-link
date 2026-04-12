import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_HOTKEY_FOCUS_SEARCH,
  DEFAULT_HOTKEY_RANDOM_CURATE,
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
          discordControlEnabled: false,
          discordControlSessionToken: null,
          discordControlWsUrl: null,
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
          discordControlEnabled: false,
          discordControlSessionToken: null,
          discordControlWsUrl: null,
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
          <h1>Welcome to osu-link</h1>
          <p className="onboarding-tagline">Search, collect, import — osu!stable.</p>
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
              Connects to your osu! account for <strong>search</strong> (official API). Beatmaps download from a community
              mirror (the official download API is osu!-client only).
            </p>
            <ul className="onboarding-list">
              <li>Create a one-time <strong>OAuth app</strong> on osu!.</li>
              <li>Sign in in the browser — osu-link never sees your password.</li>
              <li>Imports go to your osu! <strong>Songs</strong> folder (auto-detected).</li>
            </ul>
            <p className="hint">~1 min if you already use osu!</p>
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
              Create an <strong>OAuth app</strong> on your osu! account for search API access (we can&apos;t do this for you).
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
              <li>On osu!, name the app anything (e.g. &quot;osu-link&quot;).</li>
              <li>Paste the callback URL above into <strong>Application callback URL</strong>.</li>
              <li>Submit, then copy <strong>Client ID</strong> and <strong>Client secret</strong> below.</li>
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

            <p className="hint">
              Close other osu-link windows before sign-in (login uses port <strong>42813</strong>). Scopes:{" "}
              <code>public</code>, <code>identify</code>, <code>friends.read</code>.
            </p>

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
            <p>Beatmaps import here (from osu! or your override):</p>
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
            <p className="hint">Leave blank for a normal install. Press F5 in osu! if imports don&apos;t show.</p>
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
              <strong>Ready.</strong> Saves OAuth keys locally, then opens the browser to approve access.
            </p>
            <p className="hint">
              Party/social need your party server URL when you use them.
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
