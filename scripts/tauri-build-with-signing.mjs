import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = join(root, ".tauri", "osu-link.key");
const key = readFileSync(keyPath, "utf8").trim();

const result = spawnSync("npx", ["tauri", "build"], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key },
  shell: true,
});

process.exit(result.status ?? 1);
