mod beatmap_avg_pp;
mod collections;
mod discord_control;
mod party_discovery;
mod import;
mod local_library;
mod oauth;
mod osu_api;
mod paths;
mod settings;
mod user_beatmap_best;

use collections::{load_collection_store, save_collection_store, CollectionStore};
use std::collections::HashMap;
use serde::Serialize;
use serde_json::Value;
use settings::{load_settings, save_settings, Settings};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    logged_in: bool,
    username: Option<String>,
    /// osu! user id from `GET /api/v2/me` (for UI when party-server `/me` is unavailable).
    osu_id: Option<i64>,
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
            osu_id: None,
        });
    };
    let s = load_settings();
    if s.client_id.is_empty() || s.client_secret.is_empty() {
        return Ok(AuthStatus {
            logged_in: true,
            username: None,
            osu_id: None,
        });
    }
    let token = oauth::ensure_fresh_access_token(
        s.client_id.trim(),
        s.client_secret.trim(),
        &mut bundle,
    )
    .await?;
    let me = osu_api::api_me(&token).await.ok();
    let username = me.as_ref().and_then(|v| {
        v.get("username")
            .and_then(|x| x.as_str())
            .map(std::string::ToString::to_string)
    });
    let osu_id = me.as_ref().and_then(|v| v.get("id").and_then(|x| x.as_i64()));
    Ok(AuthStatus {
        logged_in: true,
        username,
        osu_id,
    })
}

pub(crate) async fn search_beatmapsets_impl(input: osu_api::SearchInput) -> Result<Value, String> {
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
async fn search_beatmapsets(input: osu_api::SearchInput) -> Result<Value, String> {
    search_beatmapsets_impl(input).await
}

/// Average PP from global leaderboard scores (`GET /beatmaps/{id}/scores`, mean of `pp` on returned scores).
#[tauri::command]
async fn get_beatmap_avg_pp(
    beatmap_ids: Vec<i64>,
    ruleset: String,
) -> Result<std::collections::HashMap<i64, Option<f64>>, String> {
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
    Ok(beatmap_avg_pp::get_avg_pp_batch(&token, &beatmap_ids, &ruleset).await)
}

#[tauri::command]
async fn get_beatmapset(beatmapset_id: i64) -> Result<Value, String> {
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
    osu_api::api_beatmapset(&token, beatmapset_id).await
}

#[tauri::command]
async fn get_user_bests_on_beatmaps(
    beatmap_ids: Vec<i64>,
    user_id: i64,
    ruleset: String,
) -> Result<HashMap<i64, Option<Value>>, String> {
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
    Ok(
        user_beatmap_best::get_user_bests_batch(&token, &beatmap_ids, user_id, &ruleset).await,
    )
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

/// Beatmapset IDs found under the resolved Songs folder (folder name or `.osu` header).
#[tauri::command]
fn get_local_beatmapset_ids() -> Result<Vec<i64>, String> {
    let s = load_settings();
    let dir = paths::resolve_beatmap_directory(s.beatmap_directory.as_deref())?;
    local_library::scan_local_beatmapset_ids(&dir)
}

pub(crate) async fn download_and_import_impl(set_id: i64, no_video: bool) -> Result<String, String> {
    let s = load_settings();
    let songs = paths::resolve_beatmap_directory(s.beatmap_directory.as_deref())?;
    let urls = osu_api::mirror_download_urls(set_id, no_video);
    let mut errors: Vec<String> = Vec::new();

    for url in urls {
        let bytes = match osu_api::download_bytes_from_url(&url).await {
            Ok(b) => b,
            Err(e) => {
                errors.push(format!("{url}: {e}"));
                continue;
            }
        };
        if bytes.len() < 200 {
            errors.push(format!(
                "{url}: response too small ({} bytes)",
                bytes.len()
            ));
            continue;
        }
        if bytes.starts_with(br#"{"#) {
            let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]);
            errors.push(format!("{url}: expected archive, got JSON/text: {head}"));
            continue;
        }
        if !import::looks_like_zip(&bytes) {
            errors.push(format!(
                "{url}: not a ZIP archive (incomplete or wrong content-type)"
            ));
            continue;
        }

        let tmp = match import::write_download_to_temp(&bytes) {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!("{url}: {e}"));
                continue;
            }
        };

        let dest = match import::extract_osz(&tmp, &songs, set_id) {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                errors.push(format!("{url}: extract failed: {e}"));
                continue;
            }
        };
        let _ = std::fs::remove_file(&tmp);

        match import::validate_beatmap_folder(&dest) {
            Ok(()) => return Ok(dest.to_string_lossy().into_owned()),
            Err(e) => {
                if dest.is_dir() {
                    let _ = std::fs::remove_dir_all(&dest);
                }
                errors.push(format!("{url}: {e}"));
            }
        }
    }

    Err(format!(
        "Could not import a complete beatmap set after trying {} mirror(s).\n{}",
        errors.len(),
        errors.join("\n")
    ))
}

#[tauri::command]
async fn download_and_import(set_id: i64, no_video: bool) -> Result<String, String> {
    download_and_import_impl(set_id, no_video).await
}

#[tauri::command]
fn load_collections_cmd() -> CollectionStore {
    load_collection_store()
}

#[tauri::command]
fn save_collections_cmd(store: CollectionStore) -> Result<(), String> {
    save_collection_store(&store)
}

async fn fresh_token() -> Result<(Settings, String), String> {
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
    Ok((s, token))
}

#[tauri::command]
async fn social_api_get(path: String) -> Result<Value, String> {
    let (s, token) = fresh_token().await?;
    let base = crate::party_discovery::resolve_social_api_base_effective(&s)
        .await
        .ok_or_else(|| "Set Party server URL or Social API base URL (Settings).".to_string())?;
    let p = path.trim();
    let p = if p.starts_with('/') { p } else { return Err("Path must start with /".into()) };
    let url = format!("{}{}", base.trim_end_matches('/'), p);
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("social API {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("JSON: {e}: {text}"))
}

#[tauri::command]
async fn social_api_post(path: String, body: Option<Value>) -> Result<Value, String> {
    let (s, token) = fresh_token().await?;
    let base = crate::party_discovery::resolve_social_api_base_effective(&s)
        .await
        .ok_or_else(|| "Set Party server URL or Social API base URL (Settings).".to_string())?;
    let p = path.trim();
    let p = if p.starts_with('/') { p } else { return Err("Path must start with /".into()) };
    let url = format!("{}{}", base.trim_end_matches('/'), p);
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("social API {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("JSON: {e}: {text}"))
}

#[tauri::command]
async fn social_api_delete(path: String) -> Result<Value, String> {
    let (s, token) = fresh_token().await?;
    let base = crate::party_discovery::resolve_social_api_base_effective(&s)
        .await
        .ok_or_else(|| "Set Party server URL or Social API base URL (Settings).".to_string())?;
    let p = path.trim();
    let p = if p.starts_with('/') { p } else { return Err("Path must start with /".into()) };
    let url = format!("{}{}", base.trim_end_matches('/'), p);
    let client = reqwest::Client::new();
    let res = client
        .delete(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("social API {status}: {text}"));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| format!("JSON: {e}: {text}"))
}

#[tauri::command]
async fn osu_friends() -> Result<Value, String> {
    let (_s, token) = fresh_token().await?;
    osu_api::api_friends(&token).await
}

#[tauri::command]
async fn osu_user_profile(user_id: i64) -> Result<Value, String> {
    let (_s, token) = fresh_token().await?;
    osu_api::api_user(&token, user_id).await
}

#[tauri::command]
async fn osu_user_ruleset_stats(user_id: i64, mode: String) -> Result<Value, String> {
    let (_s, token) = fresh_token().await?;
    osu_api::api_user_ruleset_stats(&token, user_id, mode.trim()).await
}

#[tauri::command]
async fn osu_user_recent_scores(user_id: i64, limit: Option<u32>, mode: Option<String>) -> Result<Value, String> {
    let (_s, token) = fresh_token().await?;
    let lim = limit.unwrap_or(20);
    let m = mode.as_deref().unwrap_or("osu");
    osu_api::api_user_recent_scores(&token, user_id, lim, m).await
}

#[tauri::command]
async fn osu_user_best_scores(
    user_id: i64,
    limit: Option<u32>,
    mode: Option<String>,
    offset: Option<u32>,
) -> Result<Value, String> {
    let (_s, token) = fresh_token().await?;
    let lim = limit.unwrap_or(100);
    let m = mode.as_deref().unwrap_or("osu");
    osu_api::api_user_scores(&token, user_id, "best", lim, m, offset).await
}

#[tauri::command]
async fn osu_user_first_scores(
    user_id: i64,
    limit: Option<u32>,
    mode: Option<String>,
    offset: Option<u32>,
) -> Result<Value, String> {
    let (_s, token) = fresh_token().await?;
    let lim = limit.unwrap_or(100);
    let m = mode.as_deref().unwrap_or("osu");
    osu_api::api_user_scores(&token, user_id, "first", lim, m, offset).await
}

#[tauri::command]
async fn discord_control_prepare_pairing() -> Result<Value, String> {
    discord_control::prepare_pairing().await
}

#[tauri::command]
async fn discord_control_pairing_status() -> Result<Value, String> {
    discord_control::pairing_status().await
}

#[tauri::command]
async fn discord_control_revoke() -> Result<(), String> {
    discord_control::revoke_session().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                discord_control::run_forever(handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings_cmd,
            oauth_login,
            oauth_logout,
            auth_status,
            search_beatmapsets,
            get_beatmap_avg_pp,
            get_beatmapset,
            get_user_bests_on_beatmaps,
            get_beatmap_dir,
            preview_beatmap_dir,
            get_local_beatmapset_ids,
            download_and_import,
            load_collections_cmd,
            save_collections_cmd,
            social_api_get,
            social_api_post,
            social_api_delete,
            osu_friends,
            osu_user_profile,
            osu_user_ruleset_stats,
            osu_user_recent_scores,
            osu_user_best_scores,
            osu_user_first_scores,
            discord_control_prepare_pairing,
            discord_control_pairing_status,
            discord_control_revoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
