# Broken beatmap cleanup + auto-repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect incomplete beatmap folders and automatically repair them by re-downloading beatmapsets; expose manual + automatic cleanup in Settings (after download and on Rescan Songs).

**Architecture:** Improve Rust-side beatmap validation (missing `.osu`, missing audio, missing background). Add Tauri commands to scan Songs, determine beatmapset id, and repair by re-download+extract into Songs then atomically swap folders. Wire commands to Settings UI via toggles and a “Clean now” button and hook into both “download/import complete” and “Rescan Songs”.

**Tech Stack:** Tauri (Rust backend commands), React/TSX frontend, existing osu! mirror download flow (`download_and_import_impl`), filesystem operations.

---

## File map (units / responsibilities)

**Rust (desktop)**
- Modify: `src-tauri/src/import.rs`
  - Extend `validate_beatmap_folder` to validate background image references.
  - Add helper(s) to parse background file reference and resolve assets case-insensitively (support subfolders).
- Modify: `src-tauri/src/local_library.rs`
  - Add helper to list immediate beatmap folders and attempt to determine set id + validate.
- Create: `src-tauri/src/repair.rs`
  - Implement repair operations:
    - Repair single set id (download/extract/validate).
    - Scan Songs folders, validate, map to set id, repair in place.
    - Return a structured summary (counts + failures).
- Modify: `src-tauri/src/lib.rs`
  - Register new commands: `repair_broken_beatmaps`, `repair_beatmapset`.
- Modify: `src-tauri/src/settings.rs`
  - Add booleans:
    - `auto_repair_broken_beatmaps_after_download`
    - `auto_repair_broken_beatmaps_on_rescan`

**Frontend**
- Modify: `src/SettingsPanel.tsx`
  - Add two toggles + “Clean up broken beatmaps now” button.
- Modify: `src/App.tsx` (or wherever settings load/save + refreshPaths live)
  - Plumb new settings fields to `SettingsPanelState`.
  - Wrap `refreshPaths` so it optionally calls repair before/after.
- Modify: `src/useSearchDownloadState.ts`
  - After successful `download_and_import`, if setting enabled, invoke `repair_beatmapset` (or `repair_broken_beatmaps` as fallback) then refresh paths.

---

### Task 1: Add background parsing + stronger validation

**Files:**
- Modify: `src-tauri/src/import.rs`
- Test: `src-tauri/src/import.rs` (unit tests module)

- [ ] **Step 1: Add failing tests for background parsing**

Add tests that parse `[Events]` background lines like:

```rust
#[test]
fn parse_background_from_events_line() {
    let osu = r#"
osu file format v14

[Events]
//Background and Video events
0,0,"bg.jpg",0,0
"#;
    assert_eq!(super::parse_background_filename(osu), Some("bg.jpg".to_string()));
}
```

- [ ] **Step 2: Run Rust tests (expect FAIL)**

Run: `cargo test -p osu-link-tauri` (or `cargo test` in `src-tauri`)
Expected: compile/test failure because `parse_background_filename` doesn’t exist yet.

- [ ] **Step 3: Implement parsing + asset resolution**

Implement:
- `parse_background_filename(osu_text: &str) -> Option<String>`:
  - Find `[Events]` section; accept common `0,0,"file",0,0` and tolerate spaces.
  - Only accept quoted filename, ignore storyboard/video entries.
- `resolve_asset_path(map_dir: &Path, raw: &str) -> PathBuf` (generalization of current `resolve_audio_path`)
- `asset_exists_case_insensitive(map_dir: &Path, raw: &str) -> bool`
  - First try direct path.
  - If missing, fallback to scanning the folder tree for a case-insensitive match on the basename (limit depth reasonably).
- Extend `validate_beatmap_folder` to:
  - Check `.osu` exists (already)
  - For each `.osu` (or at least first N), validate audio + background (if present).

- [ ] **Step 4: Run Rust tests (expect PASS)**

Run: `cargo test` (in `src-tauri`)
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/import.rs
git commit -m "fix: validate beatmap backgrounds during import"
```

---

### Task 2: Implement repair engine + commands

**Files:**
- Create: `src-tauri/src/repair.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/local_library.rs`
- Test: `src-tauri/src/repair.rs` (unit tests)

- [ ] **Step 1: Add Rust types + failing tests**

Define serializable summary types:
- `RepairSummary { scanned: u32, broken: u32, repaired: u32, failures: Vec<RepairFailure> }`
- `RepairFailure { path: String, reason: String, beatmapset_id: Option<i64> }`

Add tests for helper `beatmapset_id_from_folder` behavior and that a folder with no detectable id returns `None`.

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `cargo test`
Expected: failures for missing module/functions.

- [ ] **Step 3: Implement repair flow**

In `repair.rs`:
- `repair_beatmapset(set_id: i64, songs_dir: &Path, no_video: bool) -> Result<String, String>`
  - Call existing `download_and_import_impl(set_id, no_video)` (move/duplicate into a shared function if needed).
- `repair_broken_beatmaps(songs_dir: &Path, no_video: bool) -> RepairSummary`
  - Iterate immediate child directories of Songs.
  - Validate with `import::validate_beatmap_folder`.
  - If broken:
    - Determine set id (reuse logic from `local_library.rs`).
    - If known: attempt repair by downloading+extracting a fresh folder.
      - Swap strategy: rename broken folder to temp, download new, validate, then delete temp; on failure restore.
    - If unknown: record failure.

Expose Tauri commands in `lib.rs`:
- `repair_broken_beatmaps_cmd(no_video: bool) -> Result<RepairSummary, String>`
- `repair_beatmapset_cmd(set_id: i64, no_video: bool) -> Result<String, String>`

- [ ] **Step 4: Run tests (expect PASS)**

Run: `cargo test`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/repair.rs src-tauri/src/lib.rs src-tauri/src/local_library.rs
git commit -m "feat: add beatmap repair commands"
```

---

### Task 3: Persist settings toggles (Rust + frontend state)

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/SettingsPanel.tsx`
- Modify: `src/App.tsx` (or wherever settings are typed/loaded)

- [ ] **Step 1: Add fields to Rust settings with defaults**

Add booleans with default false to `Settings` and ensure serde camelCase names match frontend.

- [ ] **Step 2: Add fields to `SettingsPanelState`**

Add:
- `autoRepairBrokenBeatmapsAfterDownload: boolean`
- `autoRepairBrokenBeatmapsOnRescan: boolean`

- [ ] **Step 3: Render UI controls**

In `SettingsPanel.tsx` add:
- A “Library maintenance” section:
  - checkbox: Auto-repair after download
  - checkbox: Auto-repair on Rescan Songs
  - button: Clean up broken beatmaps now

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/settings.rs src/SettingsPanel.tsx src/App.tsx
git commit -m "feat: add auto-repair settings toggles"
```

---

### Task 4: Wire manual cleanup + auto hooks (download + rescan)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/useSearchDownloadState.ts`

- [ ] **Step 1: Manual cleanup button**

Wire button to invoke `repair_broken_beatmaps` and show a summary message/toast.

- [ ] **Step 2: Auto on download**

After a successful download/import:
- If enabled: invoke `repair_beatmapset(set_id)` (or `repair_broken_beatmaps` if needed)
- Then refresh paths.

- [ ] **Step 3: Auto on rescan**

In `refreshPaths`:
- If enabled: run `repair_broken_beatmaps` then continue with existing rescan flow.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/useSearchDownloadState.ts
git commit -m "feat: auto-repair broken beatmaps on download and rescan"
```

---

## Verification

- [ ] Run Rust tests: `cargo test` in `src-tauri`
- [ ] Run frontend typecheck/build: `npm test`/`npm run build` (whatever repo uses)
- [ ] Manual:
  - Download a beatmapset; confirm it imports and doesn’t leave a broken folder.
  - Break a set by deleting audio/background; click “Clean up broken beatmaps now”; confirm it repairs.
  - Enable auto-repair on rescan; break a set; press “Rescan Songs”; confirm it repairs.

