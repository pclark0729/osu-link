use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::Path;

/// Leading digits in osu!'s default folder name: `{id} Artist - Title`.
fn beatmapset_id_from_folder_name(name: &str) -> Option<i64> {
    let s = name.trim_start();
    let mut end = 0usize;
    for c in s.chars() {
        if c.is_ascii_digit() {
            end += c.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 || end > 15 {
        return None;
    }
    s[..end].parse().ok()
}

fn beatmapset_id_from_osu_header(buf: &[u8]) -> Option<i64> {
    let text = String::from_utf8_lossy(buf);
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line
            .strip_prefix("BeatmapSetID")
            .or_else(|| line.strip_prefix("beatmapsetid"))
        else {
            continue;
        };
        let rest = rest.trim_start_matches(|c: char| c == ':' || c.is_whitespace());
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if num.is_empty() {
            continue;
        }
        if let Ok(n) = num.parse::<i64>() {
            return Some(n);
        }
    }
    None
}

fn first_osu_path_in_folder(dir: &Path) -> Option<std::path::PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for ent in entries.flatten() {
        let path = ent.path();
        if path.is_file() {
            if path.extension().is_some_and(|e| e == "osu") {
                return Some(path);
            }
        }
    }
    None
}

const OSU_HEADER_READ_MAX: usize = 131_072;

fn beatmapset_id_from_folder(dir: &Path, folder_name: &str) -> Option<i64> {
    if let Some(id) = beatmapset_id_from_folder_name(folder_name) {
        return Some(id);
    }
    let osu = first_osu_path_in_folder(dir)?;
    let mut f = fs::File::open(&osu).ok()?;
    let mut buf = vec![0u8; OSU_HEADER_READ_MAX];
    let n = f.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    beatmapset_id_from_osu_header(&buf)
}

/// Scans the Songs folder: one beatmapset id per immediate child directory.
pub fn scan_local_beatmapset_ids(songs_dir: &Path) -> Result<Vec<i64>, String> {
    if !songs_dir.is_dir() {
        return Err(format!("Songs path is not a directory: {}", songs_dir.display()));
    }
    let mut set: HashSet<i64> = HashSet::new();
    let entries = fs::read_dir(songs_dir).map_err(|e| e.to_string())?;
    for ent in entries.flatten() {
        let path = ent.path();
        if !path.is_dir() {
            continue;
        }
        let name = ent.file_name();
        let folder_name = name.to_string_lossy();
        if let Some(id) = beatmapset_id_from_folder(&path, &folder_name) {
            if id > 0 {
                set.insert(id);
            }
        }
    }
    let mut v: Vec<i64> = set.into_iter().collect();
    v.sort_unstable();
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_name_parses() {
        assert_eq!(beatmapset_id_from_folder_name("12345 Artist - Title"), Some(12345));
        assert_eq!(beatmapset_id_from_folder_name("  999 Mapper"), Some(999));
        assert_eq!(beatmapset_id_from_folder_name("no id here"), None);
    }

    #[test]
    fn osu_header_parses() {
        let s = b"osu file format v14\n\n[General]\nAudioFilename: x.mp3\nBeatmapSetID:42\n";
        assert_eq!(beatmapset_id_from_osu_header(s), Some(42));
    }
}
