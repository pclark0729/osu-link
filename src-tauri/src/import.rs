use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

/// ZIP local file header magic (PK\x03\x04).
pub fn looks_like_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b && bytes[2] == 0x03 && bytes[3] == 0x04
}

#[cfg(test)]
mod tests {
    use super::looks_like_zip;

    #[test]
    fn looks_like_zip_accepts_local_header() {
        assert!(looks_like_zip(&[0x50, 0x4b, 0x03, 0x04, 0x00]));
    }

    #[test]
    fn looks_like_zip_rejects_short_and_non_zip() {
        assert!(!looks_like_zip(&[]));
        assert!(!looks_like_zip(&[0x50, 0x4b, 0x03]));
        assert!(!looks_like_zip(b"not-a-zip"));
    }
}

fn parse_audio_filename(osu_head: &str) -> Option<String> {
    for line in osu_head.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("AudioFilename:") {
            let v = rest.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn parse_background_filename(osu_text: &str) -> Option<String> {
    // Look for the first background event in `[Events]`.
    // Typical formats:
    // 0,0,"bg.jpg",0,0
    // 0,0,bg.jpg,0,0
    let mut in_events = false;
    for raw in osu_text.lines() {
        let line = raw.trim();
        if line.starts_with('[') && line.ends_with(']') {
            in_events = line.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        let t = line.trim_start_matches('\u{feff}').trim();
        if !(t.starts_with("0,0,") || t.starts_with("0, 0,")) {
            continue;
        }
        // Find first quoted string, else fall back to third CSV field.
        if let Some(q1) = t.find('"') {
            if let Some(q2) = t[q1 + 1..].find('"') {
                let inside = &t[q1 + 1..q1 + 1 + q2];
                let v = inside.trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
        // CSV-ish fallback: split by comma and take 3rd field.
        let parts: Vec<&str> = t.split(',').collect();
        if parts.len() >= 3 {
            let v = parts[2].trim().trim_matches('"');
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn resolve_audio_path(map_dir: &Path, audio_raw: &str) -> PathBuf {
    let mut p = map_dir.to_path_buf();
    for part in audio_raw.replace('\\', "/").split('/') {
        if !part.is_empty() {
            p.push(part);
        }
    }
    p
}

fn resolve_relative_path(map_dir: &Path, raw: &str) -> PathBuf {
    let mut p = map_dir.to_path_buf();
    for part in raw.replace('\\', "/").split('/') {
        if !part.is_empty() {
            p.push(part);
        }
    }
    p
}

fn find_case_insensitive_path(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut cur = root.to_path_buf();
    let normalized = rel.replace('\\', "/");
    let mut parts = normalized
        .split('/')
        .filter(|p| !p.is_empty())
        .peekable();
    while let Some(seg) = parts.next() {
        let want = seg.trim();
        if want.is_empty() {
            continue;
        }
        let is_last = parts.peek().is_none();

        let mut matched: Option<PathBuf> = None;
        let entries = fs::read_dir(&cur).ok()?;
        for ent in entries.flatten() {
            let name = ent.file_name().to_string_lossy().into_owned();
            if name.eq_ignore_ascii_case(want) {
                let p = ent.path();
                matched = Some(p);
                break;
            }
            if is_last {
                // For leaf file, also allow matching leaf name even if rel included a subpath that doesn't exist
                // (some .osu files reference a file without the correct subfolder).
            }
        }
        let Some(p) = matched else {
            return None;
        };
        if is_last {
            return Some(p);
        }
        if !p.is_dir() {
            return None;
        }
        cur = p;
    }
    Some(cur)
}

fn file_exists_case_insensitive(map_dir: &Path, rel: &str) -> bool {
    // First try the exact path.
    let p = resolve_relative_path(map_dir, rel);
    if p.is_file() {
        return true;
    }
    // Then try segment-by-segment case-insensitive resolution.
    find_case_insensitive_path(map_dir, rel).is_some_and(|p| p.is_file())
}

/// Ensures at least one `.osu` exists and the file named in `AudioFilename:` is present (unless virtual / empty).
pub fn validate_beatmap_folder(map_dir: &Path) -> Result<(), String> {
    let mut osu_paths: Vec<PathBuf> = Vec::new();
    for ent in fs::read_dir(map_dir).map_err(|e| e.to_string())? {
        let p = ent.map_err(|e| e.to_string())?.path();
        if p.is_file()
            && p.extension()
                .and_then(|e| e.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("osu"))
                .unwrap_or(false)
        {
            osu_paths.push(p);
        }
    }
    if osu_paths.is_empty() {
        return Err(
            "Imported folder has no .osu difficulty files — the download may be incomplete.".into(),
        );
    }

    let f = File::open(&osu_paths[0]).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(512 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    let head = String::from_utf8_lossy(&buf);

    let Some(audio_name) = parse_audio_filename(&head) else {
        return Ok(());
    };
    let audio_trim = audio_name.trim();
    if audio_trim.is_empty() || audio_trim.eq_ignore_ascii_case("virtual") {
        return Ok(());
    }

    let audio_path = resolve_audio_path(map_dir, audio_trim);
    if audio_path.is_file() {
        return Ok(());
    }

    if let Some(want) = audio_path.file_name().and_then(|n| n.to_str()) {
        for ent in fs::read_dir(map_dir).map_err(|e| e.to_string())? {
            let p = ent.map_err(|e| e.to_string())?.path();
            if p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.eq_ignore_ascii_case(want))
                    .unwrap_or(false)
            {
                return Ok(());
            }
        }
    }

    Err(format!(
        "missing audio file \"{audio_trim}\" (incomplete archive)"
    ))
}

/// Stricter validator used by repair:
/// - requires at least one `.osu`
/// - ensures referenced `AudioFilename` exists (case-insensitive, supports subfolders)
/// - ensures referenced background image exists (case-insensitive, supports subfolders) when present
pub fn validate_beatmap_folder_strict(map_dir: &Path) -> Result<(), String> {
    let mut osu_paths: Vec<PathBuf> = Vec::new();
    for ent in fs::read_dir(map_dir).map_err(|e| e.to_string())? {
        let p = ent.map_err(|e| e.to_string())?.path();
        if p.is_file()
            && p.extension()
                .and_then(|e| e.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("osu"))
                .unwrap_or(false)
        {
            osu_paths.push(p);
        }
    }
    if osu_paths.is_empty() {
        return Err("folder has no .osu files".into());
    }

    // Inspect up to a few difficulties to reduce false negatives.
    osu_paths.sort();
    let mut checked = 0usize;
    for osu in osu_paths.iter().take(6) {
        let f = File::open(osu).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.take(1024 * 1024)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&buf);

        if let Some(audio_name) = parse_audio_filename(&text) {
            let a = audio_name.trim();
            if !a.is_empty() && !a.eq_ignore_ascii_case("virtual") {
                if !file_exists_case_insensitive(map_dir, a) {
                    return Err(format!("missing audio file \"{a}\""));
                }
            }
        }

        if let Some(bg) = parse_background_filename(&text) {
            let b = bg.trim();
            if !b.is_empty() {
                if !file_exists_case_insensitive(map_dir, b) {
                    return Err(format!("missing background file \"{b}\""));
                }
            }
        }
        checked += 1;
    }
    if checked == 0 {
        return Err("could not read any .osu files".into());
    }
    Ok(())
}

/// Extract `.osz` (zip) into `dest_root`, preserving archive paths (zip-slip safe via `enclosed_name`).
/// Flat archives (files only at zip root) extract into `{dest_root}/{set_id} osu-link/` so the Songs folder is not polluted.
/// Returns the path to the beatmap folder osu! should load (contains `.osu` and assets).
pub fn extract_osz(osz_path: &Path, dest_root: &Path, set_id: i64) -> Result<PathBuf, String> {
    fs::create_dir_all(dest_root).map_err(|e| e.to_string())?;
    let file = File::open(osz_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("invalid .osz / zip: {e}"))?;

    let mut entry_names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let n = entry.name().to_string();
        if !n.ends_with('/') && !n.is_empty() {
            entry_names.push(n);
        }
    }

    let flat = entry_names.iter().all(|n| !n.contains('/') && !n.contains('\\'));

    let extract_root = if flat {
        dest_root.join(format!("{set_id} osu-link"))
    } else {
        dest_root.to_path_buf()
    };
    if flat {
        fs::create_dir_all(&extract_root).map_err(|e| e.to_string())?;
    }

    let mut first_top: Option<PathBuf> = None;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };

        if first_top.is_none() {
            if let Some(std::path::Component::Normal(seg)) = rel.components().next() {
                first_top = Some(PathBuf::from(seg));
            }
        }

        let outpath = extract_root.join(&rel);
        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    let base = if flat {
        extract_root
    } else {
        match first_top {
            Some(d) => {
                let p = dest_root.join(&d);
                if p.is_dir() {
                    p
                } else {
                    dest_root.to_path_buf()
                }
            }
            None => dest_root.to_path_buf(),
        }
    };

    Ok(base)
}

pub fn write_download_to_temp(bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("osu-link-downloads");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{}.osz", chrono::Utc::now().timestamp_millis());
    let path = dir.join(name);
    let mut f = File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod strict_tests {
    use super::parse_background_filename;

    #[test]
    fn parses_background_from_events() {
        let s = r#"
osu file format v14

[Events]
//Background and Video events
0,0,"bg.jpg",0,0
"#;
        assert_eq!(parse_background_filename(s).as_deref(), Some("bg.jpg"));
    }
}
