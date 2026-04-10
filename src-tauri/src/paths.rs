use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

/// Default osu!stable Songs folder when BeatmapDirectory is unset.
pub fn default_songs_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("osu!")
        .join("Songs")
}

/// Find `BeatmapDirectory:` in osu! user cfg files (`%LocalAppData%\osu!\osu!*.cfg`).
pub fn resolve_beatmap_directory(override_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = override_path {
        let pb = PathBuf::from(p.trim());
        if pb.is_dir() {
            return Ok(pb);
        }
        return Err(format!("Beatmap directory override is not a folder: {}", pb.display()));
    }

    let osu_dir = dirs::data_local_dir()
        .ok_or_else(|| "could not resolve %LOCALAPPDATA%".to_string())?
        .join("osu!");

    if !osu_dir.is_dir() {
        return Ok(default_songs_dir());
    }

    let entries = fs::read_dir(&osu_dir).map_err(|e| e.to_string())?;
    for ent in entries.flatten() {
        let name = ent.file_name().to_string_lossy().into_owned();
        if !name.starts_with("osu!") || !name.ends_with(".cfg") {
            continue;
        }
        if let Some(dir) = read_beatmap_directory_from_cfg(&ent.path())? {
            if dir.is_dir() {
                return Ok(dir);
            }
        }
    }

    Ok(default_songs_dir())
}

fn read_beatmap_directory_from_cfg(path: &Path) -> Result<Option<PathBuf>, String> {
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(f);
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("BeatmapDirectory") {
            let rest = rest.trim_start();
            let rest = rest.strip_prefix(':').unwrap_or(rest).trim();
            if rest.is_empty() {
                continue;
            }
            let val = rest.trim_matches('"');
            if !val.is_empty() {
                return Ok(Some(PathBuf::from(val)));
            }
        }
    }
    Ok(None)
}
