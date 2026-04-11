//! Windows: global overlay hotkeys via low-level keyboard hooks (`handy-keys`), similar to Overwolf.
//! Tauri’s `RegisterHotKey` path often fails when osu! or other games use raw input.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use handy_keys::{Hotkey, HotkeyManager, HotkeyState};
use tauri::AppHandle;
use tauri::Emitter;

use crate::osu_process::is_osu_running;
use crate::settings::load_settings;

const EVENT_NAME: &str = "overlay-hotkey";

struct Runner {
    stop: std::sync::Arc<AtomicBool>,
    join: JoinHandle<()>,
}

impl Runner {
    fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.join.join();
    }
}

static RUNNER: Mutex<Option<Runner>> = Mutex::new(None);

fn stop_runner() {
    let mut lock = match RUNNER.lock() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("[osu-link] overlay hotkeys mutex poisoned: {e}");
            return;
        }
    };
    if let Some(r) = lock.take() {
        r.stop();
    }
}

fn default_toggle() -> String {
    "Shift+Tab".to_string()
}

fn default_focus() -> String {
    "Ctrl+Shift+F".to_string()
}

/// Start the hook thread from [`tauri::Builder::setup`].
pub fn start(app: &AppHandle) {
    let s = load_settings();
    if !s.overlay_enabled {
        stop_runner();
        return;
    }
    let toggle = s
        .overlay_hotkey
        .as_ref()
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(default_toggle);
    let focus = s
        .overlay_focus_hotkey
        .as_ref()
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(default_focus);
    reload_inner(app.clone(), toggle, focus);
}

/// Reload bindings after settings are saved (or on demand).
pub fn reload(app: &AppHandle) {
    let s = load_settings();
    if !s.overlay_enabled {
        stop_runner();
        return;
    }
    let toggle = s
        .overlay_hotkey
        .as_ref()
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(default_toggle);
    let focus = s
        .overlay_focus_hotkey
        .as_ref()
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(default_focus);
    reload_inner(app.clone(), toggle, focus);
}

fn reload_inner(app: AppHandle, toggle_s: String, focus_s: String) {
    {
        let mut lock = match RUNNER.lock() {
            Ok(g) => g,
            Err(e) => {
                eprintln!("[osu-link] overlay hotkeys mutex poisoned: {e}");
                return;
            }
        };
        if let Some(r) = lock.take() {
            r.stop();
        }
    }

    if toggle_s == focus_s {
        eprintln!("[osu-link] overlay hotkeys: toggle and focus are identical; not registering.");
        return;
    }

    let toggle_hk: Hotkey = match toggle_s.parse() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[osu-link] invalid overlay toggle hotkey {toggle_s:?}: {e}");
            return;
        }
    };
    let focus_hk: Hotkey = match focus_s.parse() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[osu-link] invalid overlay focus hotkey {focus_s:?}: {e}");
            return;
        }
    };

    let stop = std::sync::Arc::new(AtomicBool::new(false));
    let stop_t = std::sync::Arc::clone(&stop);
    let app_t = app.clone();

    let join = thread::spawn(move || {
        // Blocking mode swallows the chord so osu! / other hooks do not handle Shift+Tab first.
        let manager = match HotkeyManager::new_with_blocking() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[osu-link] HotkeyManager::new_with_blocking failed: {e}");
                return;
            }
        };

        let tid = match manager.register(toggle_hk) {
            Ok(id) => id,
            Err(e) => {
                eprintln!("[osu-link] register toggle hotkey: {e}");
                return;
            }
        };
        let fid = match manager.register(focus_hk) {
            Ok(id) => id,
            Err(e) => {
                eprintln!("[osu-link] register focus hotkey: {e}");
                return;
            }
        };

        while !stop_t.load(Ordering::SeqCst) {
            // Drain the whole channel each iteration — a single try_recv per sleep window was dropping bursts
            // (e.g. Shift+Tab) under load.
            let mut any = false;
            while let Some(ev) = manager.try_recv() {
                any = true;
                if ev.state != HotkeyState::Pressed {
                    continue;
                }
                // Gate on process only: eligibility uses HWND rules that can be false while osu! still has focus
                // (e.g. exclusive fullscreen / focus quirks), which would silence hotkeys entirely.
                if !is_osu_running() {
                    continue;
                }
                let action: &str = if ev.id == tid {
                    "toggle"
                } else if ev.id == fid {
                    "focus"
                } else {
                    continue;
                };
                // Broadcast so the main webview's `listen` always receives (matches default event scope).
                if let Err(e) = app_t.emit(EVENT_NAME, action.to_string()) {
                    eprintln!("[osu-link] emit overlay-hotkey {action}: {e}");
                }
            }
            if !any {
                thread::sleep(Duration::from_millis(8));
            }
        }
        drop(manager);
    });

    let mut lock = RUNNER.lock().unwrap();
    *lock = Some(Runner { stop, join });
}
