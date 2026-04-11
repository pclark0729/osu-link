/**
 * Resolves the app semver from git / CI and syncs package.json, package-lock,
 * src-tauri/tauri.conf.json, and src-tauri/Cargo.toml (via sync-tauri-version.mjs).
 *
 * Priority:
 *   1. RELEASE_VERSION or TAURI_BUILD_VERSION (explicit)
 *   2. GITHUB_REF=refs/tags/vX.Y.Z on tag builds
 *   3. Latest v* tag at HEAD: exact X.Y.Z if on tag; else X.Y.Z-N (N = commits after tag; numeric
 *      prerelease only — required for WiX/MSI, which rejects identifiers like "dev.N")
 *   4. No tags: 0.1.0-N (N = total commits)
 *
 * Skip with TAURI_SKIP_VERSION_SYNC=1 (e.g. local builds when you want a clean tree).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execSync(`git ${args}`, { encoding: "utf8", cwd: root }).trim();
}

function resolveVersion() {
  const explicit = process.env.RELEASE_VERSION || process.env.TAURI_BUILD_VERSION;
  if (explicit?.trim()) {
    const v = explicit.trim();
    if (!/^\d+\.\d+\.\d+/.test(v)) {
      console.error(`Invalid RELEASE_VERSION/TAURI_BUILD_VERSION: ${v}`);
      process.exit(1);
    }
    return v;
  }

  const ref = process.env.GITHUB_REF || "";
  const tagRef = ref.match(/^refs\/tags\/(v\d+\.\d+\.\d+)/);
  if (tagRef) {
    return tagRef[1].replace(/^v/, "");
  }

  if (!existsSync(path.join(root, ".git"))) {
    console.warn("[resolve-version] No .git; keeping package.json version.");
    return null;
  }

  try {
    const tag = git('describe --tags --abbrev=0 --match "v*"');
    const base = tag.replace(/^v/, "");
    const since = parseInt(git(`rev-list ${tag}..HEAD --count`), 10);
    if (Number.isNaN(since)) return `${base}-1`;
    if (since === 0) return base;
    return `${base}-${since}`;
  } catch {
    try {
      const n = parseInt(git("rev-list --count HEAD"), 10) || 0;
      return `0.1.0-${n}`;
    } catch {
      return "0.1.0";
    }
  }
}

function main() {
  if (process.env.TAURI_SKIP_VERSION_SYNC === "1") {
    console.log("[resolve-version] Skipped (TAURI_SKIP_VERSION_SYNC=1).");
    return;
  }

  const version = resolveVersion();
  if (version === null) return;

  console.log(`[resolve-version] Syncing app version to ${version}`);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r1 = spawnSync(
    npm,
    ["version", version, "--no-git-tag-version", "--allow-same-version"],
    {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (r1.status !== 0) process.exit(r1.status ?? 1);

  const r2 = spawnSync(process.execPath, ["scripts/sync-tauri-version.mjs", version], {
    cwd: root,
    stdio: "inherit",
  });
  if (r2.status !== 0) process.exit(r2.status ?? 1);
}

main();
