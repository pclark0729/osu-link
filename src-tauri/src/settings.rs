use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    /// Optional override for osu! Songs / beatmap directory.
    #[serde(default)]
    pub beatmap_directory: Option<String>,
    /// When false, the app shows the first-run setup wizard.
    #[serde(default)]
    pub onboarding_completed: bool,
    /// WebSocket URL for party lobbies (e.g. ws://127.0.0.1:4680).
    #[serde(default)]
    pub party_server_url: Option<String>,
    /// Optional HTTPS base for social REST API (e.g. https://127.0.0.1:4681). If unset, derived from `party_server_url`.
    #[serde(default)]
    pub social_api_base_url: Option<String>,
    /// Global shortcut to focus the window and search field (Tauri format, e.g. Alt+Shift+O). Empty = disabled.
    #[serde(default = "default_hotkey_focus_search")]
    pub hotkey_focus_search: String,
    /// Global shortcut to download one random map from Curate → Discover pool. Empty = disabled.
    #[serde(default = "default_hotkey_random_curate")]
    pub hotkey_random_curate: String,
    /// When true, maintain outbound WebSocket to the party-server `/control` relay for Discord.
    #[serde(default = "default_discord_control_enabled")]
    pub discord_control_enabled: bool,
    /// Session token for Discord control (paired with relay SQLite). Empty = not paired / cleared.
    #[serde(default)]
    pub discord_control_session_token: Option<String>,
    /// Override WebSocket URL for control (e.g. wss://example.com/control). If unset, derived from Social API base.
    #[serde(default)]
    pub discord_control_ws_url: Option<String>,
}

fn default_hotkey_focus_search() -> String {
    "Alt+Shift+O".to_string()
}

fn default_hotkey_random_curate() -> String {
    "Alt+Shift+R".to_string()
}

fn default_discord_control_enabled() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            client_secret: String::new(),
            beatmap_directory: None,
            onboarding_completed: false,
            party_server_url: None,
            social_api_base_url: None,
            hotkey_focus_search: default_hotkey_focus_search(),
            hotkey_random_curate: default_hotkey_random_curate(),
            discord_control_enabled: true,
            discord_control_session_token: None,
            discord_control_ws_url: None,
        }
    }
}

pub fn app_storage_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("osu-link")
}

pub fn settings_path() -> PathBuf {
    app_storage_dir().join("settings.json")
}

pub fn load_settings() -> Settings {
    let path = settings_path();
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            let mut s: Settings = serde_json::from_value(raw.clone()).unwrap_or_default();
            let had_onboarding_key = raw.get("onboardingCompleted").is_some();
            // Older settings.json had no flag; existing OAuth users skip the wizard once.
            if !had_onboarding_key
                && !s.client_id.trim().is_empty()
                && !s.client_secret.trim().is_empty()
            {
                s.onboarding_completed = true;
            }
            return s;
        }
    }
    Settings::default()
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let dir = app_storage_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = settings_path();
    let j = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, j).map_err(|e| e.to_string())
}

/// Default hosted party WebSocket (must match frontend `HOSTED_PARTY_WS_URL` when user has no saved URL).
pub(crate) const DEFAULT_PARTY_WS_FALLBACK: &str = "wss://osulink.peyton-clark.com";

/// Apply optional URL drafts from the settings UI (may be unsaved) for pairing / resolution.
pub fn settings_with_draft_urls(
    disk: &Settings,
    party_server_url_draft: Option<String>,
    social_api_base_url_draft: Option<String>,
) -> Settings {
    let mut s = disk.clone();
    if let Some(p) = party_server_url_draft {
        let t = p.trim();
        s.party_server_url = if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        };
    }
    if let Some(so) = social_api_base_url_draft {
        let t = so.trim();
        s.social_api_base_url = if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        };
    }
    s
}

/// Party / social API base derived only from explicit settings (no hosted default, no LAN discovery).
pub fn resolve_social_api_base_from_saved_settings(settings: &Settings) -> Option<String> {
    if let Some(ref u) = settings.social_api_base_url {
        let t = u.trim();
        if !t.is_empty() {
            return Some(t.trim_end_matches('/').to_string());
        }
    }
    let ws = settings.party_server_url.as_deref().map(str::trim).filter(|s| !s.is_empty())?;
    party_ws_to_http_base(ws)
}

/// Hosted HTTPS API base when the user has not configured a party URL (used if mDNS finds nothing).
pub(crate) fn default_hosted_social_api_base() -> String {
    party_ws_to_http_base(DEFAULT_PARTY_WS_FALLBACK).expect("default party ws maps to https")
}

fn party_ws_to_http_base(ws: &str) -> Option<String> {
    let ws = ws.trim();
    if ws.is_empty() {
        return None;
    }
    if let Some(rest) = ws.strip_prefix("ws://") {
        if let Some(colon) = rest.rfind(':') {
            let host = &rest[..colon];
            let port = &rest[colon + 1..];
            if port == "4680" {
                return Some(format!("http://{host}:4681"));
            }
        }
        return Some(format!("http://{rest}"));
    }
    if let Some(rest) = ws.strip_prefix("wss://") {
        if let Some(colon) = rest.rfind(':') {
            let host = &rest[..colon];
            let port = &rest[colon + 1..];
            if port == "4680" {
                return Some(format!("https://{host}:4681"));
            }
        }
        return Some(format!("https://{rest}"));
    }
    None
}

pub(crate) fn http_base_to_control_ws_url(base: &str) -> Option<String> {
    let base = base.trim().trim_end_matches('/');
    if let Some(rest) = base.strip_prefix("https://") {
        if rest.is_empty() {
            return None;
        }
        return Some(format!("wss://{}/control", rest));
    }
    if let Some(rest) = base.strip_prefix("http://") {
        if rest.is_empty() {
            return None;
        }
        return Some(format!("ws://{}/control", rest));
    }
    None
}

#[cfg(test)]
mod control_ws_url_tests {
    use super::http_base_to_control_ws_url;

    #[test]
    fn lan_http_maps_to_ws() {
        assert_eq!(
            http_base_to_control_ws_url("http://192.168.1.5:4681").as_deref(),
            Some("ws://192.168.1.5:4681/control")
        );
    }

    #[test]
    fn public_https_maps_to_wss() {
        assert_eq!(
            http_base_to_control_ws_url("https://osulink.peyton-clark.com").as_deref(),
            Some("wss://osulink.peyton-clark.com/control")
        );
    }

    #[test]
    fn https_with_port_maps_to_wss() {
        assert_eq!(
            http_base_to_control_ws_url("https://example.com:4681").as_deref(),
            Some("wss://example.com:4681/control")
        );
    }
}
