/**
 * Sets src-tauri/tauri.conf.json and src-tauri/Cargo.toml [package].version.
 * Run after `npm version <semver> --no-git-tag-version` so package.json / lock stay aligned.
 * Usage: node scripts/sync-tauri-version.mjs 1.2.3
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/sync-tauri-version.mjs <semver> (e.g. 1.2.3)");
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const tauriPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));
if (tauri.version !== version) {
  tauri.version = version;
  fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");
}

const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
let cargo = fs.readFileSync(cargoPath, "utf8").replace(/\r\n/g, "\n");
const updated = cargo.replace(
  /(\[package\][\s\S]*?^version = ")[^"]+(")/m,
  `$1${version}$2`
);
if (updated === cargo) {
  const m = cargo.match(/\[package\][\s\S]*?^version = "([^"]+)"/m);
  if (m?.[1] === version) {
    console.log(`Cargo.toml already at ${version}`);
  } else {
    console.error('Could not find [package] version = "..." in Cargo.toml');
    process.exit(1);
  }
} else {
  fs.writeFileSync(cargoPath, updated);
}

console.log(`Synced Tauri/Cargo version to ${version}`);
