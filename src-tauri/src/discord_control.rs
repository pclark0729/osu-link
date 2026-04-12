//! Outbound WebSocket to party-server `/control` for Discord-originated commands.

use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use crate::osu_api;
use crate::party_discovery::{
    resolve_discord_control_ws_url_effective, resolve_social_api_base_effective,
};
use crate::settings::{load_settings, save_settings, settings_with_draft_urls, Settings};

const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// After this many failed connects in a row, back off to [`DISCORD_CONTROL_LONG_RETRY_SECS`] instead of hammering every few seconds.
const DISCORD_CONTROL_QUICK_RETRY_CAP: u32 = 10;
const DISCORD_CONTROL_SHORT_RETRY_SECS: u64 = 4;
const DISCORD_CONTROL_LONG_RETRY_SECS: u64 = 60;

fn gen_pair_code() -> String {
    let mut rng = rand::thread_rng();
    let mut s = String::with_capacity(6);
    for _ in 0..6 {
        s.push(CROCKFORD[rng.gen_range(0..CROCKFORD.len())] as char);
    }
    s
}

fn gen_session_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

fn sha256_hex(secret: &str) -> String {
    let mut h = Sha256::new();
    h.update(secret.as_bytes());
    hex::encode(h.finalize())
}

fn emit_status(app: &AppHandle, connected: bool) {
    let _ = app.emit(
        "discord-control-status",
        json!({ "connected": connected }),
    );
}

/// Start pairing: register `tokenHash` on relay and persist session token locally.
pub async fn prepare_pairing(
    party_server_url_draft: Option<String>,
    social_api_base_url_draft: Option<String>,
) -> Result<Value, String> {
    let disk = load_settings();
    let mut s = settings_with_draft_urls(&disk, party_server_url_draft, social_api_base_url_draft);
    let base = resolve_social_api_base_effective(&s)
        .await
        .ok_or_else(|| "Set Party server URL or Social API base URL (Settings).".to_string())?;
    let token = gen_session_token();
    let code = gen_pair_code();
    let token_hash = sha256_hex(&token);
    let url = format!(
        "{}/api/v1/discord-control/pairing",
        base.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .json(&json!({ "code": code, "tokenHash": token_hash }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("pairing HTTP {}: {}", status, body));
    }
    s.discord_control_session_token = Some(token);
    s.discord_control_enabled = true;
    save_settings(&s)?;
    Ok(json!({ "code": code }))
}

pub async fn pairing_status() -> Result<Value, String> {
    let s = load_settings();
    let token = s
        .discord_control_session_token
        .as_deref()
        .filter(|x| !x.is_empty())
        .ok_or_else(|| "No session token".to_string())?;
    let base = resolve_social_api_base_effective(&s)
        .await
        .ok_or_else(|| "Set Party server URL or Social API base URL.".to_string())?;
    let url = format!(
        "{}/api/v1/discord-control/status",
        base.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("JSON: {e}: {text}"))
}

pub async fn revoke_session() -> Result<(), String> {
    let s = load_settings();
    let Some(token) = s.discord_control_session_token.as_deref().filter(|x| !x.is_empty()) else {
        let mut s = s;
        s.discord_control_enabled = false;
        save_settings(&s)?;
        return Ok(());
    };
    if let Some(base) = resolve_social_api_base_effective(&s).await {
        let url = format!(
            "{}/api/v1/discord-control/revoke",
            base.trim_end_matches('/')
        );
        let _ = reqwest::Client::new()
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await;
    }
    let mut s = load_settings();
    s.discord_control_session_token = None;
    s.discord_control_enabled = false;
    save_settings(&s)?;
    Ok(())
}

fn summarize_search(v: &Value) -> String {
    let Some(arr) = v.get("beatmapsets").and_then(|x| x.as_array()) else {
        return "No beatmapsets in response.".to_string();
    };
    if arr.is_empty() {
        return "No results.".to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    for b in arr.iter().take(8) {
        let title = b
            .get("title")
            .and_then(|x| x.as_str())
            .unwrap_or("?");
        let artist = b
            .get("artist")
            .and_then(|x| x.as_str())
            .unwrap_or("?");
        let id = b.get("id").and_then(|x| x.as_i64()).unwrap_or(0);
        lines.push(format!("• [{id}] {artist} — {title}"));
    }
    if arr.len() > 8 {
        lines.push(format!("… and {} more.", arr.len() - 8));
    }
    lines.join("\n")
}

async fn handle_incoming_json(text: &str) -> Result<Option<String>, String> {
    let msg: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if msg.get("type").and_then(|x| x.as_str()) == Some("hello") {
        return Ok(None);
    }
    let id = msg
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "missing id".to_string())?
        .to_string();
    let cmd = msg
        .get("command")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "missing command".to_string())?;

    match cmd {
        "ping" => Ok(Some(
            json!({ "v": 1, "id": id, "ok": true, "type": "pong" }).to_string(),
        )),
        "download" => {
            let set_id = msg
                .get("beatmapsetId")
                .or_else(|| msg.get("beatmapset_id"))
                .and_then(|x| x.as_i64())
                .ok_or_else(|| "beatmapsetId required".to_string())?;
            let no_video = msg
                .get("noVideo")
                .or_else(|| msg.get("no_video"))
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            match crate::download_and_import_impl(set_id, no_video).await {
                Ok(path) => Ok(Some(
                    json!({
                        "v": 1,
                        "id": id,
                        "ok": true,
                        "type": "download_result",
                        "path": path
                    })
                    .to_string(),
                )),
                Err(e) => Ok(Some(
                    json!({ "v": 1, "id": id, "ok": false, "error": e }).to_string(),
                )),
            }
        }
        "search" => {
            let query = msg
                .get("query")
                .and_then(|x| x.as_str())
                .ok_or_else(|| "query required".to_string())?;
            let mut input = osu_api::SearchInput::default();
            input.q = Some(query.to_string());
            match crate::search_beatmapsets_impl(input).await {
                Ok(v) => {
                    let summary = summarize_search(&v);
                    Ok(Some(
                        json!({
                            "v": 1,
                            "id": id,
                            "ok": true,
                            "type": "search_result",
                            "summary": summary
                        })
                        .to_string(),
                    ))
                }
                Err(e) => Ok(Some(
                    json!({ "v": 1, "id": id, "ok": false, "error": e }).to_string(),
                )),
            }
        }
        _ => Ok(Some(
            json!({ "v": 1, "id": id, "ok": false, "error": "unknown_command" }).to_string(),
        )),
    }
}

async fn one_connection(app: AppHandle, settings: &Settings) -> Result<(), String> {
    let token = settings
        .discord_control_session_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "no token".to_string())?;
    let ws_url = resolve_discord_control_ws_url_effective(settings)
        .await
        .ok_or_else(|| "no ws url".to_string())?;

    let mut request = ws_url
        .as_str()
        .into_client_request()
        .map_err(|e| e.to_string())?;
    request.headers_mut().insert(
        http::header::AUTHORIZATION,
        format!("Bearer {}", token)
            .parse()
            .map_err(|e| format!("header: {e}"))?,
    );

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("connect: {e}"))?;
    let (mut write, mut read) = ws_stream.split();
    emit_status(&app, true);

    while let Some(next) = read.next().await {
        let msg = next.map_err(|e| e.to_string())?;
        match msg {
            Message::Text(t) => {
                if let Ok(reply) = handle_incoming_json(&t).await {
                    if let Some(s) = reply {
                        let _ = write.send(Message::Text(s)).await;
                    }
                }
            }
            Message::Ping(p) => {
                let _ = write.send(Message::Pong(p)).await;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    emit_status(&app, false);
    Ok(())
}

pub async fn run_forever(app: AppHandle) {
    let mut consecutive_connect_failures: u32 = 0;
    loop {
        let s = load_settings();
        if s.discord_control_enabled
            && s.discord_control_session_token.as_deref().is_some_and(|t| !t.is_empty())
        {
            match one_connection(app.clone(), &s).await {
                Ok(()) => {
                    consecutive_connect_failures = 0;
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                Err(e) => {
                    consecutive_connect_failures =
                        consecutive_connect_failures.saturating_add(1);
                    let _ = app.emit(
                        "discord-control-status",
                        json!({ "connected": false, "error": e }),
                    );
                    let wait_secs = if consecutive_connect_failures
                        > DISCORD_CONTROL_QUICK_RETRY_CAP
                    {
                        DISCORD_CONTROL_LONG_RETRY_SECS
                    } else {
                        DISCORD_CONTROL_SHORT_RETRY_SECS
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
                }
            }
        } else {
            consecutive_connect_failures = 0;
            emit_status(&app, false);
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }
}
