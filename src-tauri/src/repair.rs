use crate::{import, local_library, osu_api, paths, settings::load_settings};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairFailure {
    pub folder: String,
    pub reason: String,
    pub beatmapset_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepairSummary {
    pub scanned: u32,
    pub broken: u32,
    pub repaired: u32,
    pub skipped: u32,
    /// Broken folders without a detectable BeatmapSetID that were deleted.
    pub deleted_unrepairable: u32,
    /// Broken folders for sets that already had a valid folder, deleted as duplicates.
    pub deleted_broken_duplicates: u32,
    pub failures: Vec<RepairFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairProgress {
    pub stage: String,
    pub current: u32,
    pub total: u32,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn validate_folder_strict(dir: &Path) -> Result<(), String> {
    import::validate_beatmap_folder_strict(dir)
}

fn child_dirs(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut v = Vec::new();
    for ent in fs::read_dir(root).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let p = ent.path();
        if !p.is_dir() {
            continue;
        }
        let name = ent.file_name().to_string_lossy().into_owned();
        v.push((name, p));
    }
    Ok(v)
}

fn beatmapset_id_from_folder(dir: &Path, folder_name: &str) -> Option<i64> {
    local_library::beatmapset_id_from_folder(dir, folder_name)
}

async fn download_extract_validate_to_staging(
    set_id: i64,
    no_video: bool,
    staging_root: &Path,
) -> Result<PathBuf, String> {
    let urls = osu_api::mirror_download_urls(set_id, no_video);
    let mut errors: Vec<String> = Vec::new();

    for url in urls {
        let bytes = match osu_api::download_bytes_from_url(&url).await {
            Ok(b) => b,
            Err(e) => {
                errors.push(format!("{url}: {e}"));
                continue;
            }
        };
        if bytes.len() < 200 {
            errors.push(format!("{url}: response too small ({} bytes)", bytes.len()));
            continue;
        }
        if bytes.starts_with(br#"{"#) {
            let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]);
            errors.push(format!("{url}: expected archive, got JSON/text: {head}"));
            continue;
        }
        if !import::looks_like_zip(&bytes) {
            errors.push(format!("{url}: not a ZIP archive"));
            continue;
        }

        let tmp = match import::write_download_to_temp(&bytes) {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!("{url}: {e}"));
                continue;
            }
        };

        let dest = match import::extract_osz(&tmp, staging_root, set_id) {
            Ok(p) => p,
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                errors.push(format!("{url}: extract failed: {e}"));
                continue;
            }
        };
        let _ = fs::remove_file(&tmp);

        match validate_folder_strict(&dest) {
            Ok(()) => return Ok(dest),
            Err(e) => {
                if dest.is_dir() {
                    let _ = fs::remove_dir_all(&dest);
                }
                errors.push(format!("{url}: {e}"));
            }
        }
    }

    Err(format!(
        "Could not repair beatmapset after trying {} mirror(s).\n{}",
        errors.len(),
        errors.join("\n")
    ))
}

fn has_any_valid_folder_for_set(songs_dir: &Path, set_id: i64) -> bool {
    if let Ok(children) = child_dirs(songs_dir) {
        for (name, path) in children {
            if beatmapset_id_from_folder(&path, &name) == Some(set_id) {
                if validate_folder_strict(&path).is_ok() {
                    return true;
                }
            }
        }
    }
    false
}

fn remove_broken_folders_for_set(songs_dir: &Path, set_id: i64) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    for (name, path) in child_dirs(songs_dir)? {
        if beatmapset_id_from_folder(&path, &name) != Some(set_id) {
            continue;
        }
        if validate_folder_strict(&path).is_ok() {
            continue;
        }
        fs::remove_dir_all(&path).map_err(|e| format!("delete {name}: {e}"))?;
        removed.push(name);
    }
    Ok(removed)
}

fn unique_dest_name(songs_dir: &Path, base: &str) -> String {
    let name = base.to_string();
    if !songs_dir.join(&name).exists() {
        return name;
    }
    for i in 2..2000u32 {
        let cand = format!("{base} ({i})");
        if !songs_dir.join(&cand).exists() {
            return cand;
        }
    }
    format!("{base}-{}", now_ms())
}

fn move_staged_into_songs(songs_dir: &Path, staged_folder: &Path, set_id: i64) -> Result<String, String> {
    let suggested = staged_folder
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{set_id} osu-link repaired"));
    let dest_name = unique_dest_name(songs_dir, &suggested);
    let dest = songs_dir.join(&dest_name);
    fs::rename(staged_folder, &dest).map_err(|e| format!("move into Songs: {e}"))?;
    Ok(dest_name)
}

async fn repair_set_id(songs_dir: &Path, set_id: i64) -> Result<(), String> {
    if has_any_valid_folder_for_set(songs_dir, set_id) {
        return Ok(());
    }
    let staging_root = std::env::temp_dir()
        .join("osu-link-repair-staging")
        .join(format!("{set_id}-{}", now_ms()));
    fs::create_dir_all(&staging_root).map_err(|e| e.to_string())?;

    let staged = download_extract_validate_to_staging(set_id, true, &staging_root).await?;

    // Double-check we still don't have a good folder (race / user actions).
    if has_any_valid_folder_for_set(songs_dir, set_id) {
        let _ = fs::remove_dir_all(&staging_root);
        return Ok(());
    }

    // Only now delete broken folders for that id.
    let _ = remove_broken_folders_for_set(songs_dir, set_id)?;

    let moved_name = move_staged_into_songs(songs_dir, &staged, set_id)?;

    // Cleanup any remaining staging dirs.
    let _ = fs::remove_dir_all(&staging_root);

    // Safety: ensure the moved folder is valid.
    let moved_path = songs_dir.join(moved_name);
    validate_folder_strict(&moved_path)?;
    Ok(())
}

pub async fn repair_broken_beatmaps(app: &tauri::AppHandle) -> Result<RepairSummary, String> {
    let s = load_settings();
    let songs_dir = paths::resolve_beatmap_directory(s.beatmap_directory.as_deref())?;
    if !songs_dir.is_dir() {
        return Err(format!("Songs path is not a directory: {}", songs_dir.display()));
    }

    let children = child_dirs(&songs_dir)?;
    let mut summary = RepairSummary::default();
    summary.scanned = children.len() as u32;

    let mut broken: Vec<(String, PathBuf, Option<i64>, String)> = Vec::new();
    let total_scan = summary.scanned.max(1);
    for (i, (name, path)) in children.into_iter().enumerate() {
        let _ = app.emit(
            "repair-progress",
            RepairProgress {
                stage: "scan".into(),
                current: (i as u32).saturating_add(1),
                total: total_scan,
            },
        );
        match validate_folder_strict(&path) {
            Ok(()) => {}
            Err(reason) => {
                let id = beatmapset_id_from_folder(&path, &name);
                broken.push((name, path, id, reason));
            }
        }
    }
    summary.broken = broken.len() as u32;

    // Deduplicate by set id; we repair per-set, not per-folder.
    let mut by_id: HashMap<i64, Vec<(String, PathBuf, String)>> = HashMap::new();
    let mut unrepairable_to_delete: Vec<(String, PathBuf, String)> = Vec::new();
    for (name, path, id, reason) in broken {
        match id {
            Some(set_id) if set_id > 0 => {
                by_id.entry(set_id).or_default().push((name, path, reason));
            }
            _ => unrepairable_to_delete.push((name, path, reason)),
        }
    }

    // Keep stable ordering for UI/logs.
    let mut ids: Vec<i64> = by_id.keys().copied().collect();
    ids.sort_unstable();

    let mut repaired_ids: HashSet<i64> = HashSet::new();
    let total_repair = ids.len().max(1) as u32;
    for (idx, set_id) in ids.into_iter().enumerate() {
        let _ = app.emit(
            "repair-progress",
            RepairProgress {
                stage: "repair".into(),
                current: (idx as u32).saturating_add(1),
                total: total_repair,
            },
        );
        let before_had_valid = has_any_valid_folder_for_set(&songs_dir, set_id);
        if before_had_valid {
            // If there's already a valid folder for this set id, we don't need to re-download.
            // But we *do* want to clean up any broken duplicates for that id.
            match remove_broken_folders_for_set(&songs_dir, set_id) {
                Ok(removed) => {
                    summary.deleted_broken_duplicates += removed.len() as u32;
                }
                Err(e) => {
                    summary.failures.push(RepairFailure {
                        folder: format!("{set_id}"),
                        reason: format!("cleanup broken duplicates failed: {e}"),
                        beatmapset_id: Some(set_id),
                    });
                }
            }
            summary.skipped += 1;
            continue;
        }
        match repair_set_id(&songs_dir, set_id).await {
            Ok(()) => {
                repaired_ids.insert(set_id);
                summary.repaired += 1;
            }
            Err(e) => {
                // Attach error to all broken folders we saw for this id.
                if let Some(folders) = by_id.get(&set_id) {
                    for (folder, _path, reason) in folders {
                        summary.failures.push(RepairFailure {
                            folder: folder.clone(),
                            reason: format!("{reason} — repair failed: {e}"),
                            beatmapset_id: Some(set_id),
                        });
                    }
                } else {
                    summary.failures.push(RepairFailure {
                        folder: format!("{set_id}"),
                        reason: e,
                        beatmapset_id: Some(set_id),
                    });
                }
            }
        }
    }

    // Delete broken folders with no detectable BeatmapSetID (unrepairable).
    for (name, path, reason) in unrepairable_to_delete {
        match fs::remove_dir_all(&path) {
            Ok(()) => summary.deleted_unrepairable += 1,
            Err(e) => summary.failures.push(RepairFailure {
                folder: name,
                reason: format!("unrepairable: {reason} (no BeatmapSetID found) — delete failed: {e}"),
                beatmapset_id: None,
            }),
        }
    }

    let _ = app.emit(
        "repair-progress",
        RepairProgress {
            stage: "done".into(),
            current: 1,
            total: 1,
        },
    );
    Ok(summary)
}

