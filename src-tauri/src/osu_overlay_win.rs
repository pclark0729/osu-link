//! Windows-only: detect whether osu! has at least one visible, non-minimized top-level window,
//! and helpers to pin the overlay above other windows.

use std::collections::HashSet;

use windows::Win32::Foundation::{FALSE, HWND, LPARAM, RECT, TRUE};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowPlacement, GetWindowRect, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, SetWindowPos, ShowWindow, HWND_TOPMOST, WINDOWPLACEMENT, SW_SHOWNOACTIVATE,
    SW_SHOWMINIMIZED, SW_SHOWMINNOACTIVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
};
use windows::core::BOOL;

struct EnumCtx {
    target_pids: HashSet<u32>,
    /// At least one HWND belonged to a target PID (osu!).
    saw_osu_hwnd: bool,
    /// At least one such window is visible and not minimized.
    has_visible_unminimized: bool,
}

struct AnchorEnumCtx {
    target_pids: HashSet<u32>,
    /// Largest eligible osu! surface (main client is usually the biggest top-level HWND).
    best: Option<(HWND, i64)>,
}

/// Returns whether the user should see the overlay: osu! is running with a normal (not minimized) window.
/// If osu! PIDs exist but no top-level HWND matched (e.g. only tray / no main window yet), returns `false`.
pub fn overlay_allowed_for_osu_pids(pids: &[u32]) -> bool {
    if pids.is_empty() {
        return false;
    }

    let target_pids: HashSet<u32> = pids.iter().copied().collect();
    let mut ctx = EnumCtx {
        target_pids,
        saw_osu_hwnd: false,
        has_visible_unminimized: false,
    };

    let lparam = LPARAM(&mut ctx as *mut EnumCtx as isize);
    unsafe {
        let _ = EnumWindows(Some(enum_proc), lparam);
    }

    if !ctx.saw_osu_hwnd {
        return false;
    }

    ctx.has_visible_unminimized
}

/// Top-level osu! client window to stack above (same rules as overlay eligibility).
pub fn find_osu_anchor_hwnd(pids: &[u32]) -> Option<HWND> {
    if pids.is_empty() {
        return None;
    }

    let target_pids: HashSet<u32> = pids.iter().copied().collect();
    let mut ctx = AnchorEnumCtx {
        target_pids,
        best: None,
    };
    let lparam = LPARAM(&mut ctx as *mut AnchorEnumCtx as isize);
    unsafe {
        let _ = EnumWindows(Some(anchor_enum_proc), lparam);
    }
    ctx.best.map(|(hwnd, _)| hwnd)
}

/// Place the overlay **immediately above** osu!'s window in the Z order, then re-assert the topmost band.
/// Games often manage z-order; relative placement + `HWND_TOPMOST` works more reliably than either alone.
pub fn stack_overlay_above_osu(overlay: HWND, pids: &[u32]) {
    if let Some(anchor) = find_osu_anchor_hwnd(pids) {
        unsafe {
            let _ = SetWindowPos(
                overlay,
                Some(anchor),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
            let _ = SetWindowPos(
                overlay,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
        }
        return;
    }

    pin_window_topmost(overlay);
}

/// Show the overlay without activating it, so osu! can keep foreground (avoids "minimize when unfocused").
pub fn show_overlay_without_activation(hwnd: HWND, pids: &[u32]) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    stack_overlay_above_osu(hwnd, pids);
}

/// Show a window without activating it (keeps another webview from stealing foreground when the overlay is focused).
pub fn show_window_no_activate(hwnd: HWND) {
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
}

/// Re-apply topmost z-order (fallback when osu! HWND is not found).
pub fn pin_window_topmost(hwnd: HWND) {
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE,
        );
    }
}

unsafe extern "system" fn anchor_enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut AnchorEnumCtx);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if !ctx.target_pids.contains(&pid) {
        return TRUE;
    }

    if osu_window_allows_overlay(hwnd) {
        let mut r = RECT::default();
        let area = if GetWindowRect(hwnd, &mut r).is_ok() {
            let w = (r.right - r.left) as i64;
            let h = (r.bottom - r.top) as i64;
            w.saturating_mul(h)
        } else {
            0
        };
        let replace = match ctx.best {
            None => true,
            Some((_, best_area)) => area > best_area,
        };
        if replace {
            ctx.best = Some((hwnd, area));
        }
    }

    TRUE
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut EnumCtx);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if !ctx.target_pids.contains(&pid) {
        return TRUE;
    }

    ctx.saw_osu_hwnd = true;

    if osu_window_allows_overlay(hwnd) {
        ctx.has_visible_unminimized = true;
        return FALSE;
    }

    TRUE
}

/// True when this HWND is the main osu! client surface (visible, not minimized to taskbar / tray).
unsafe fn osu_window_allows_overlay(hwnd: HWND) -> bool {
    if IsWindowVisible(hwnd).0 == 0 || IsIconic(hwnd).0 != 0 {
        return false;
    }

    let mut placement = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        ..Default::default()
    };
    if GetWindowPlacement(hwnd, &mut placement).is_ok() {
        let sc = placement.showCmd;
        if sc == SW_SHOWMINIMIZED.0 as u32 || sc == SW_SHOWMINNOACTIVE.0 as u32 {
            return false;
        }
    }

    true
}
