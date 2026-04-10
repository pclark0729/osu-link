use serde::{Deserialize, Serialize};
use std::fs;
use tiny_http::{Header, Response, Server};
use urlencoding::encode;

use crate::settings::app_storage_dir;

const TOKEN_URL: &str = "https://osu.ppy.sh/oauth/token";
const AUTH_URL: &str = "https://osu.ppy.sh/oauth/authorize";

/// OAuth tokens are stored in the app data dir instead of the OS credential store:
/// Windows Credential Manager limits the password field to ~2560 characters, and osu!
/// token payloads can exceed that when serialized.
fn tokens_path() -> std::path::PathBuf {
    app_storage_dir().join("oauth_tokens.json")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TokenBundle {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at_epoch: i64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

fn random_state() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}

pub fn load_tokens() -> Result<Option<TokenBundle>, String> {
    let path = tokens_path();
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let t: TokenBundle = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(Some(t))
}

pub fn save_tokens(bundle: &TokenBundle) -> Result<(), String> {
    let dir = app_storage_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = tokens_path();
    let s = serde_json::to_string_pretty(bundle).map_err(|e| e.to_string())?;
    fs::write(path, s).map_err(|e| e.to_string())
}

pub fn clear_tokens() -> Result<(), String> {
    let path = tokens_path();
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn refresh_access_token(client_id: &str, client_secret: &str, refresh: &str) -> Result<TokenBundle, String> {
    let client = reqwest::Client::new();
    let body = format!(
        "client_id={}&client_secret={}&grant_type=refresh_token&refresh_token={}",
        encode(client_id),
        encode(client_secret),
        encode(refresh)
    );
    let res = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("token refresh failed: {t}"));
    }
    let tr: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    let expires_at_epoch = chrono::Utc::now().timestamp() + tr.expires_in - 60;
    Ok(TokenBundle {
        access_token: tr.access_token,
        refresh_token: tr.refresh_token,
        expires_at_epoch,
    })
}

/// Returns access token, refreshing if needed (and persisting new bundle).
pub async fn ensure_fresh_access_token(
    client_id: &str,
    client_secret: &str,
    bundle: &mut TokenBundle,
) -> Result<String, String> {
    let now = chrono::Utc::now().timestamp();
    if now < bundle.expires_at_epoch {
        return Ok(bundle.access_token.clone());
    }
    let newb = refresh_access_token(client_id, client_secret, &bundle.refresh_token).await?;
    *bundle = newb.clone();
    save_tokens(&newb)?;
    Ok(bundle.access_token.clone())
}

pub async fn exchange_code(client_id: &str, client_secret: &str, code: &str, redirect_uri: &str) -> Result<TokenBundle, String> {
    let client = reqwest::Client::new();
    let body = format!(
        "client_id={}&client_secret={}&code={}&grant_type=authorization_code&redirect_uri={}",
        encode(client_id),
        encode(client_secret),
        encode(code),
        encode(redirect_uri)
    );
    let res = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("token exchange failed: {t}"));
    }
    let tr: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    let expires_at_epoch = chrono::Utc::now().timestamp() + tr.expires_in - 60;
    Ok(TokenBundle {
        access_token: tr.access_token,
        refresh_token: tr.refresh_token,
        expires_at_epoch,
    })
}

fn parse_query(url: &str) -> std::collections::HashMap<String, String> {
    let mut m = std::collections::HashMap::new();
    let q = url.split('?').nth(1).unwrap_or("");
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("").to_string();
        let v = it.next().unwrap_or("").to_string();
        if let Ok(dec) = urlencoding::decode(&v) {
            m.insert(k, dec.into_owned());
        } else {
            m.insert(k, v);
        }
    }
    m
}

/// Fixed port so your osu! OAuth app can use a single redirect URI:
/// `http://127.0.0.1:42813/callback`
const OAUTH_LOOPBACK_PORT: u16 = 42813;

/// Run loopback OAuth; returns token bundle on success.
pub fn authorize_interactive(client_id: &str, client_secret: &str) -> Result<TokenBundle, String> {
    let addr = format!("127.0.0.1:{OAUTH_LOOPBACK_PORT}");
    let server = Server::http(&addr).map_err(|e| {
        format!(
            "could not bind {addr} (is another osu-link instance signing in?). Close other copies or free the port. ({e})"
        )
    })?;
    let redirect_uri = format!("http://127.0.0.1:{OAUTH_LOOPBACK_PORT}/callback");
    let state = random_state();
    let auth = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
        AUTH_URL,
        encode(client_id),
        encode(&redirect_uri),
        encode("public identify"),
        encode(&state)
    );

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let st = state.clone();
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            if !url.starts_with("/callback") {
                let _ = request.respond(Response::from_string("not found").with_status_code(404));
                continue;
            }
            let q = parse_query(&url);
            let ok_html = "<!DOCTYPE html><html><body><p>Sign-in complete. You can close this tab and return to osu-link.</p></body></html>";
            let err_html = "<!DOCTYPE html><html><body><p>Sign-in failed. Close this tab and try again.</p></body></html>";
            let ctype = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap();

            if q.get("state").map(String::as_str) != Some(st.as_str()) {
                let _ = request.respond(Response::from_string(err_html).with_status_code(400).with_header(ctype.clone()));
                let _ = tx.send(Err("OAuth state mismatch".into()));
                return;
            }
            if let Some(code) = q.get("code").filter(|c| !c.is_empty()) {
                let _ = request.respond(Response::from_string(ok_html).with_header(ctype));
                let _ = tx.send(Ok(code.clone()));
                return;
            }
            let _ = request.respond(Response::from_string(err_html).with_status_code(400).with_header(ctype));
            let _ = tx.send(Err("missing authorization code".into()));
            return;
        }
        let _ = tx.send(Err("OAuth server stopped before callback".into()));
    });

    std::thread::sleep(std::time::Duration::from_millis(250));
    open::that(&auth).map_err(|e| format!("open browser: {e}"))?;

    let code = rx
        .recv_timeout(std::time::Duration::from_secs(600))
        .map_err(|_| "OAuth timed out (10 minutes)".to_string())?
        .map_err(|e| e)?;

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let bundle = rt.block_on(exchange_code(client_id, client_secret, &code, &redirect_uri))?;
    save_tokens(&bundle)?;
    Ok(bundle)
}
