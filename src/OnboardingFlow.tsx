import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { OAUTH_REDIRECT_URI, OSU_OAUTH_LIST_URL, OSU_OAUTH_NEW_APP_URL } from "./constants";

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
          <p className="onboarding-tagline">Search, collect, and import beatmaps into osu!stable.</p>
        </div>

        <nav className="onboarding-steps" aria-label="Setup steps">
          {STEPS.map((label, i) => (
            <span key={label} className={`onboarding-step-pill ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
              <span className="onboarding-step-num">{i + 1}</span>
              {label}
            </span>
          ))}
        </nav>

        {error && <div className="error-banner onboarding-error">{error}</div>}

        {step === 0 && (
          <div className="onboarding-body">
            <p>
              This setup connects osu-link to your osu! account for <strong>search</strong> (official API). Beatmap files are
              downloaded from a community mirror — the official download API is only available to the osu! client, not
              third-party OAuth apps.
            </p>
            <ul className="onboarding-list">
              <li>You will create a free <strong>OAuth application</strong> on osu! (one-time).</li>
              <li>You sign in through your browser; osu-link never sees your osu! password.</li>
              <li>Beatmaps are saved into your osu! <strong>Songs</strong> folder (we detect it automatically).</li>
            </ul>
            <p className="hint">Takes about one minute if you already have an osu! account.</p>
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
              osu! requires a small <strong>OAuth app</strong> tied to <em>your</em> account so the app can call the search API as you.
              We cannot create this for you automatically.
            </p>

            <div className="onboarding-action-grid">
              <button type="button" className="primary" onClick={() => void openNewApp()}>
                Open osu! — new OAuth app
              </button>
              <button type="button" className="secondary" onClick={() => void openAppList()}>
                I already have an OAuth app
              </button>
            </div>

            <div className="onboarding-redirect-box">
              <span className="field-label">Application callback URL (paste into osu!)</span>
              <code className="onboarding-callback">{OAUTH_REDIRECT_URI}</code>
              <button type="button" className="secondary onboarding-copy" onClick={() => void copyRedirect()}>
                Copy callback URL
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
                <input type="text" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From osu! OAuth page" />
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
              Close other osu-link windows before signing in. The app listens on port 42813 during login. Requested scopes:{" "}
              <code>public</code>, <code>identify</code>, <code>friends.read</code> (Social tab / osu! friends list).
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
            <p>We will import beatmaps into this folder (read from osu! or your override):</p>
            <div className="onboarding-path-preview">
              <code>{previewPath || "…"}</code>
            </div>
            <label className="field">
              <span>Override Songs folder (optional)</span>
              <input
                type="text"
                placeholder="Leave empty to use osu!.cfg / default"
                value={beatmapOverride}
                onChange={(e) => setBeatmapOverride(e.target.value)}
              />
            </label>
            <p className="hint">If osu! is installed normally, you can leave this blank. Press F5 in osu! after importing if maps don’t appear.</p>
            <div className="onboarding-actions">
              <button type="button" className="secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button type="button" className="primary" onClick={() => setStep(3)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-body">
            <p>
              <strong>Ready.</strong> We will save your OAuth keys on this PC, then open the browser so you can approve access.
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
