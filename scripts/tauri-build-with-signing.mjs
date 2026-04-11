/**
 * Windows/macOS/Linux installer build. Signing:
 * - Prefer env TAURI_SIGNING_PRIVATE_KEY (set in GitHub Actions secrets for CI).
 * - Else read .tauri/osu-link.key if that file exists (local dev only).
 * - Else build unsigned (valid for CI; updater pubkey in app must match if you sign releases elsewhere).
 *
 * If CI fails with readFileSync on line 8, the workflow is running an OLD copy of this file — push this script to GitHub.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = join(root, ".tauri", "osu-link.key");

function readKeyFromDisk() {
  if (!existsSync(keyPath)) return null;
  try {
    return readFileSync(keyPath, "utf8").trim();
  } catch {
    return null;
  }
}

const env = { ...process.env };

if (process.env.CI === "true") {
  const k = env.TAURI_SIGNING_PRIVATE_KEY;
  console.log(
    `[tauri-build] CI: TAURI_SIGNING_PRIVATE_KEY ${k?.trim() ? `set (${k.length} chars)` : "NOT SET — add repo secret TAURI_SIGNING_PRIVATE_KEY or build unsigned"}`,
  );
}

if (env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
  console.log("Using TAURI_SIGNING_PRIVATE_KEY from environment.");
} else {
  const fromDisk = readKeyFromDisk();
  if (fromDisk) {
    env.TAURI_SIGNING_PRIVATE_KEY = fromDisk;
    console.log(`Using signing key from ${keyPath}`);
  } else {
    console.warn(
      "No TAURI_SIGNING_PRIVATE_KEY and no readable .tauri/osu-link.key — building an unsigned installer (normal for CI).",
    );
  }
}

const result = spawnSync("npx", ["tauri", "build"], {
  stdio: "inherit",
  cwd: root,
  env,
  shell: true,
});

process.exit(result.status ?? 1);
