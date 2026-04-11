//! Detect osu!stable (`osu!.exe` on Windows). Used to gate the overlay global shortcut.

/// Returns true when the osu! stable client process is running (Windows only).
#[tauri::command]
pub fn is_osu_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        is_osu_stable_running_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn is_osu_stable_running_windows() -> bool {
    !osu_stable_pids().is_empty()
}

/// PIDs whose executable looks like osu!stable (`osu!.exe`).
#[cfg(target_os = "windows")]
pub(crate) fn osu_stable_pids() -> Vec<u32> {
    use sysinfo::System;

    let sys = System::new_all();
    sys.processes()
        .iter()
        .filter(|(_, p)| {
            let name = p.name().to_string_lossy();
            exe_name_looks_like_osu_stable(name.as_ref())
        })
        .map(|(pid, _)| pid.as_u32())
        .collect()
}

/// True when osu! is running **and** it has a visible, non-minimized window (so the overlay is not shown over the desktop while osu is minimized).
#[tauri::command]
pub fn is_osu_overlay_eligible() -> bool {
    #[cfg(target_os = "windows")]
    {
        let pids = osu_stable_pids();
        if pids.is_empty() {
            return false;
        }
        crate::osu_overlay_win::overlay_allowed_for_osu_pids(&pids)
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// True if the process executable name looks like osu!stable (Windows `osu!.exe`).
#[cfg(target_os = "windows")]
fn exe_name_looks_like_osu_stable(name: &str) -> bool {
    let n = name.trim();
    // Typical: `osu!.exe` (sysinfo usually returns file name, not full path).
    if n.eq_ignore_ascii_case("osu!.exe") || n.eq_ignore_ascii_case("osu!") {
        return true;
    }
    let lower = n.to_lowercase();
    lower.ends_with("\\osu!.exe") || lower.ends_with("/osu!.exe")
}
