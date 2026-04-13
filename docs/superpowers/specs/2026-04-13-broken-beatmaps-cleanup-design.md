# Broken beatmap cleanup + auto-repair

Date: 2026-04-13

## Problem

Users can end up with beatmap folders in their osu! `Songs/` directory that are **incomplete**:

- Download/import appears to succeed, but the extracted folder is missing critical assets (e.g. no `.osu`, missing audio, missing background).
- osu! shows the set but fails to load due to missing files.

We want to **fix the issue at download time** and add a **Settings feature** to clean up broken folders, including an option to run automatically:

- Automatically after a download/import completes
- Automatically when the user clicks “Rescan Songs”

Cleanup behavior should be “**C**”: attempt to re-download/repair automatically, and only take destructive action if repair fails.

## Goals

- Prevent osu-link from leaving incomplete beatmap folders in `Songs/` after a download/import.
- Provide a one-click cleanup that:
  - Detects broken beatmap folders
  - Attempts automatic repair by re-downloading the beatmapset
  - Reports what was repaired and what could not be repaired
- Provide settings:
  - Manual “Clean up broken beatmaps now”
  - Toggle: auto-repair after download
  - Toggle: auto-repair on Rescan Songs

## Non-goals

- Perfectly validating every possible osu! file reference (storyboards, skins, videos beyond “no video”, etc.) in v1.
- Repairing folders that do not contain a detectable `BeatmapSetID` and have no ID in the folder name.

## Definitions

### “Broken beatmap folder”

A folder under the resolved `Songs/` directory is considered broken if:

- It contains **no** `.osu` files, OR
- At least one `.osu` references an `AudioFilename` that cannot be found in the folder (case-insensitive match; supports subfolders), OR
- A `.osu` references a background image in the `[Events]` section that cannot be found in the folder (case-insensitive match; supports subfolders)

### “Repair”

If the beatmapset id is known, repair is:

- Re-download `.osz` using existing mirror strategy
- Extract into `Songs/` (same destination root as current)
- Validate the extracted folder using the stricter validator above
- If valid: replace the broken folder (or remove it after successful replace)

If the beatmapset id cannot be determined:

- Mark folder as unrepairable and leave it in place

## Architecture / data flow

### Download/import path (`download_and_import`)

Current behavior:

- Download `.osz` from a mirror URL list
- Extract to `Songs/`
- Validate minimally (presence of `.osu` + referenced audio file)
- On validation failure, delete extracted folder and try next mirror

Change:

- Upgrade validation to also detect missing background image references (common osu! “missing file” cause).
- Keep current mirror retry semantics: if validation fails, delete extracted folder and try next mirror.
- If the user has “auto-repair after download” enabled, also run a lightweight check to ensure the resulting folder remains valid; if not, surface error and attempt repair (normally validation should prevent this).

### Settings cleanup path

New commands:

- `repair_broken_beatmaps` (scan Songs dir, validate each folder, repair when possible)
- `repair_beatmapset` (repair a single beatmapset id; reused by scan + future hooks)

Settings UI:

- Button runs `repair_broken_beatmaps` and shows a summary toast/status.
- Rescan button:
  - Existing behavior: refresh the local beatmapset id set
  - If auto-repair-on-rescan is enabled: run repair first (or immediately after refresh), then refresh again.

### Settings persistence

Add to persistent settings model:

- `autoRepairBrokenBeatmapsAfterDownload: boolean` (default false)
- `autoRepairBrokenBeatmapsOnRescan: boolean` (default false)

## Error handling and safety

- Repair should be conservative about deletion:
  - Prefer extracting the new set, validating it, then deleting/replacing the old folder.
  - If replacement is not possible, do not delete the user’s existing folder.
- Report:
  - Number of folders scanned
  - Number broken
  - Number repaired
  - List of failures with reason (e.g. “no BeatmapSetID found”, “download failed on all mirrors”)

## Testing / verification plan

- Unit tests in Rust for:
  - Parsing background file from `.osu` `[Events]`
  - Case-insensitive asset resolution in a directory
- Manual:
  - Download a known-good set; ensure no broken folders are left behind.
  - Simulate a broken folder by deleting audio/background; run “Clean now” and confirm it repairs.
  - Toggle auto-repair on rescan; create broken folder; click Rescan; confirm it repairs.