use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

/// Extract `.osz` (zip) into `dest_root`, preserving archive paths (zip-slip safe via `enclosed_name`).
/// Returns the path to the first top-level folder inside the archive (beatmap folder), if any.
pub fn extract_osz(osz_path: &Path, dest_root: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(dest_root).map_err(|e| e.to_string())?;
    let file = File::open(osz_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("invalid .osz / zip: {e}"))?;

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

        let outpath = dest_root.join(&rel);
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

    let base = match first_top {
        Some(d) => {
            let p = dest_root.join(&d);
            if p.exists() {
                p
            } else {
                dest_root.to_path_buf()
            }
        }
        None => dest_root.to_path_buf(),
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
