# Releasing osu-link (desktop)

Automatic updates use [Tauri’s updater](https://v2.tauri.app/plugin/updater/) with artifacts hosted on **GitHub Releases**. Users of the packaged app do not need to download installers manually; the app fetches signed update metadata from `latest.json` on each session (after onboarding), or via **Settings → Check for updates**.

## Prerequisites

1. **Repository**  
   The updater endpoint in `src-tauri/tauri.conf.json` must point at the GitHub repo where you publish releases (see `plugins.updater.endpoints`).

2. **Signing key pair**  
   - Generate a key pair with the Tauri CLI (`tauri signer generate` — see upstream docs).  
   - Put the **public** key string in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) under `plugins.updater.pubkey`.  
   - Store the **private** key in the GitHub repo secret `TAURI_SIGNING_PRIVATE_KEY` (file contents or raw key text).  
   - If the key is password-protected, set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as well.  
   The private key used in CI **must** correspond to the public key shipped in the app; otherwise installs will fail signature verification.

3. **GitHub Actions**  
   Workflow: [`.github/workflows/publish-tauri.yml`](.github/workflows/publish-tauri.yml). It needs `contents: write` (default for `GITHUB_TOKEN` on tag builds) and the signing secrets above.

## Cut a release

1. Commit any code you want in the release.  
2. Create and push an annotated or lightweight tag **`vX.Y.Z`** (semver, e.g. `v1.2.3`). Only tags matching `v*` trigger the workflow.  
3. Wait for all matrix jobs (Windows, Linux, macOS arm64, macOS x64) to finish successfully. A failed job means that platform may be missing installers or updater files.  
4. Open the GitHub **Releases** page for the new tag and confirm assets include **`latest.json`** (and platform-specific bundles). The desktop app resolves updates via `…/releases/latest/download/latest.json`.

The workflow syncs the app version from the tag into `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` during the build so the built binary version matches the release and the updater can compare versions correctly.

## Verify updates end-to-end

1. Install an **older** release build on a test machine.  
2. Publish a **newer** tag and wait for CI.  
3. Launch the old app: you should be prompted to install and restart (or use Check for updates).  
4. After relaunch, confirm **Settings** (or about) shows the new version.

## Troubleshooting

| Symptom | Things to check |
|--------|------------------|
| Always “up to date” | Tag format `vX.Y.Z`; CI ran `sync-tauri-version`; built version in release matches tag. |
| Install / verify error | `TAURI_SIGNING_PRIVATE_KEY` matches `pubkey` in `tauri.conf.json`. |
| No `latest.json` on release | CI failed; check Actions logs and release assets. |
| Updates never run | Packaged app only; dev (`npm run tauri dev`) does not apply updates. |
