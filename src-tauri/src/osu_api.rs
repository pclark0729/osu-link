use serde::{Deserialize, Serialize};
use serde_json::Value;

const API: &str = "https://osu.ppy.sh/api/v2";

/// Community mirror base for `.osz` files. The official endpoint
/// `GET /api/v2/beatmapsets/{id}/download` is registered with bare `require-scopes`
/// middleware on osu-web, which only accepts tokens that have the `*` scope — that
/// scope is not available to normal user OAuth apps (`public` + `identify`), so those
/// requests fail with 403 `{"error":"Invalid scope(s) provided."}`.
const BEATMAP_MIRROR_DOWNLOAD_BASE: &str = "https://catboy.best/d";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchInput {
    pub q: Option<String>,
    /// osu! search mode int: 0 osu, 1 taiko, 2 fruits, 3 mania
    pub m: Option<u8>,
    /// `s` param: ranked, loved, pending, graveyard, qualified, etc.
    pub s: Option<String>,
    pub sort: Option<String>,
    pub cursor_string: Option<String>,
    pub g: Option<u32>,
    pub l: Option<u32>,
    /// extras: dot-separated e.g. "video"
    pub e: Option<String>,
    /// general flags: dot-separated e.g. "featured_artists"
    pub c: Option<String>,
    /// ranks: dot-separated grades
    pub r: Option<String>,
    pub nsfw: Option<bool>,
}

pub async fn api_search(access_token: &str, input: &SearchInput) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{API}/beatmapsets/search");
    let mut req = client
        .get(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .query(&[
            ("s", input.s.as_deref().unwrap_or("ranked")),
            ("sort", input.sort.as_deref().unwrap_or("plays_desc")),
        ]);

    if let Some(q) = input.q.as_ref().filter(|s| !s.is_empty()) {
        req = req.query(&[("q", q.as_str())]);
    }
    if let Some(m) = input.m {
        req = req.query(&[("m", m.to_string())]);
    }
    if let Some(cs) = input.cursor_string.as_ref().filter(|s| !s.is_empty()) {
        req = req.query(&[("cursor_string", cs.as_str())]);
    }
    if let Some(g) = input.g {
        req = req.query(&[("g", g.to_string())]);
    }
    if let Some(l) = input.l {
        req = req.query(&[("l", l.to_string())]);
    }
    if let Some(e) = input.e.as_ref().filter(|s| !s.is_empty()) {
        req = req.query(&[("e", e.as_str())]);
    }
    if let Some(c) = input.c.as_ref().filter(|s| !s.is_empty()) {
        req = req.query(&[("c", c.as_str())]);
    }
    if let Some(r) = input.r.as_ref().filter(|s| !s.is_empty()) {
        req = req.query(&[("r", r.as_str())]);
    }
    if input.nsfw == Some(true) {
        req = req.query(&[("nsfw", "true")]);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();

    if !status.is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("search failed {status}: {t}"));
    }

    res.json().await.map_err(|e| e.to_string())
}

pub async fn api_me(access_token: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{API}/me"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("/me failed: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Download beatmapset `.osz` from a public mirror (no OAuth).
pub async fn download_beatmapset_bytes(set_id: i64, no_video: bool) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(20))
        .build()
        .map_err(|e| e.to_string())?;

    let nv = if no_video { "1" } else { "0" };
    let url = format!("{BEATMAP_MIRROR_DOWNLOAD_BASE}/{set_id}?nv={nv}");

    let mut last_429 = false;
    for attempt in 0u32..4u32 {
        let res = client
            .get(&url)
            .header("User-Agent", "osu-link (https://github.com/osu-link; beatmap import)")
            .header("Accept", "application/octet-stream, application/x-osu-beatmap-archive, */*")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            last_429 = true;
            tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(attempt))).await;
            continue;
        }
        let status = res.status();
        if !status.is_success() {
            let t = res.text().await.unwrap_or_default();
            return Err(format!("download failed {status}: {t}"));
        }

        return res.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string());
    }

    Err(if last_429 {
        "Download rate limited (429) after retries. Wait before trying again.".into()
    } else {
        "Download failed after retries.".into()
    })
}
