use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
