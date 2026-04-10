mod collections;
mod import;
mod oauth;
mod osu_api;
mod paths;
mod settings;

use collections::{load_collection_store, save_collection_store, CollectionStore};
use serde::Serialize;
use serde_json::Value;
use settings::{load_settings, save_settings, Settings};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    logged_in: bool,
    username: Option<String>,
}

#[tauri::command]
fn get_settings() -> Settings {
    load_settings()
}

#[tauri::command]
fn save_settings_cmd(s: Settings) -> Result<(), String> {
    save_settings(&s)
}

#[tauri::command]
fn oauth_login() -> Result<(), String> {
    let s = load_settings();
    if s.client_id.trim().is_empty() || s.client_secret.trim().is_empty() {
        return Err("Set Client ID and Client Secret in Settings first (osu! OAuth application).".into());
    }
    oauth::authorize_interactive(s.client_id.trim(), s.client_secret.trim())?;
    Ok(())
}

#[tauri::command]
fn oauth_logout() -> Result<(), String> {
    oauth::clear_tokens()
}

#[tauri::command]
async fn auth_status() -> Result<AuthStatus, String> {
    let Some(mut bundle) = oauth::load_tokens()? else {
        return Ok(AuthStatus {
            logged_in: false,
            username: None,
        });
    };
    let s = load_settings();
    if s.client_id.is_empty() || s.client_secret.is_empty() {
        return Ok(AuthStatus {
            logged_in: true,
            username: None,
        });
    }
    let token = oauth::ensure_fresh_access_token(
        s.client_id.trim(),
        s.client_secret.trim(),
        &mut bundle,
    )
    .await?;
    let me = osu_api::api_me(&token).await.ok();
    let username = me.and_then(|v| {
        v.get("username")
            .and_then(|x| x.as_str())
            .map(std::string::ToString::to_string)
    });
    Ok(AuthStatus {
        logged_in: true,
        username,
    })
}

#[tauri::command]
async fn search_beatmapsets(input: osu_api::SearchInput) -> Result<Value, String> {
    let s = load_settings();
    if s.client_id.is_empty() || s.client_secret.is_empty() {
        return Err("Configure OAuth Client ID and Secret.".into());
    }
    let mut bundle = oauth::load_tokens()?.ok_or_else(|| "Sign in with osu! first.".to_string())?;
    let token = oauth::ensure_fresh_access_token(
        s.client_id.trim(),
        s.client_secret.trim(),
        &mut bundle,
    )
    .await?;
    osu_api::api_search(&token, &input).await
}

#[tauri::command]
fn get_beatmap_dir() -> Result<String, String> {
    let st = load_settings();
    let p = paths::resolve_beatmap_directory(st.beatmap_directory.as_deref())?;
    Ok(p.to_string_lossy().into_owned())
}

/// Resolve Songs folder using an optional path (for setup UI before settings are saved).
#[tauri::command]
fn preview_beatmap_dir(override_path: Option<String>) -> Result<String, String> {
    let o = override_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let p = paths::resolve_beatmap_directory(o)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn download_and_import(set_id: i64, no_video: bool) -> Result<String, String> {
    let s = load_settings();
    // Mirror download does not require OAuth; search still does.
    let bytes = osu_api::download_beatmapset_bytes(set_id, no_video).await?;
    if bytes.len() < 200 {
        return Err("Download was too small — the server may have returned an error page. Check login or beatmap availability.".into());
    }
    if bytes.starts_with(br#"{"#) {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(400)]);
        return Err(format!(
            "Expected a beatmap archive but got JSON/text. Try again or check API access.\n{head}"
        ));
    }
    let tmp = import::write_download_to_temp(&bytes)?;
    let songs = paths::resolve_beatmap_directory(s.beatmap_directory.as_deref())?;
    let dest = import::extract_osz(&tmp, &songs)?;
    let _ = std::fs::remove_file(&tmp);
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_collections_cmd() -> CollectionStore {
    load_collection_store()
}

#[tauri::command]
fn save_collections_cmd(store: CollectionStore) -> Result<(), String> {
    save_collection_store(&store)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings_cmd,
            oauth_login,
            oauth_logout,
            auth_status,
            search_beatmapsets,
            get_beatmap_dir,
            preview_beatmap_dir,
            download_and_import,
            load_collections_cmd,
            save_collections_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
