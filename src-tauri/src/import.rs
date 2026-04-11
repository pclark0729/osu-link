use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

/// ZIP local file header magic (PK\x03\x04).
pub fn looks_like_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b && bytes[2] == 0x03 && bytes[3] == 0x04
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

fn resolve_audio_path(map_dir: &Path, audio_raw: &str) -> PathBuf {
    let mut p = map_dir.to_path_buf();
    for part in audio_raw.replace('\\', "/").split('/') {
        if !part.is_empty() {
            p.push(part);
        }
    }
    p
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
