use serde::{Deserialize, Serialize};
use serde_json::Value;

const API: &str = "https://osu.ppy.sh/api/v2";

/// Community mirrors for `.osz` files. The official endpoint
/// `GET /api/v2/beatmapsets/{id}/download` is registered with bare `require-scopes`
/// middleware on osu-web, which only accepts tokens that have the `*` scope — that
/// scope is not available to normal user OAuth apps (`public` + `identify`), so those
/// requests fail with 403 `{"error":"Invalid scope(s) provided."}`.
///
/// Order: try catboy (Mino) first, then Sayobot CDN — some sets are incomplete on one mirror.
pub fn mirror_download_urls(set_id: i64, no_video: bool) -> Vec<String> {
    let nv = if no_video { "1" } else { "0" };
    vec![
        format!("https://catboy.best/d/{set_id}?nv={nv}"),
        if no_video {
            format!("https://txy1.sayobot.cn/beatmaps/download/novideo/{set_id}")
        } else {
            format!("https://txy1.sayobot.cn/beatmaps/download/full/{set_id}")
        },
    ]
}

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

/// Global leaderboard scores for a beatmap (`GET /api/v2/beatmaps/{id}/scores`).
pub async fn api_beatmap_scores(
    access_token: &str,
    beatmap_id: i64,
    ruleset: &str,
    limit: u32,
) -> Result<Value, String> {
    let lim = limit.min(100).max(1);
    let url = format!("{API}/beatmaps/{beatmap_id}/scores");
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .query(&[
            ("limit", lim.to_string()),
            ("legacy_only", "0".to_string()),
            ("mode", ruleset.to_string()),
        ])
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("beatmap scores HTTP {status}: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Full beatmap set (`GET /api/v2/beatmapsets/{beatmapset}`).
pub async fn api_beatmapset(access_token: &str, beatmapset_id: i64) -> Result<Value, String> {
    let url = format!("{API}/beatmapsets/{beatmapset_id}");
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("beatmapset HTTP {status}: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// User's score on a beatmap (`GET /api/v2/beatmaps/{id}/scores/users/{user}`). `None` when 404 (no play).
pub async fn api_beatmap_user_best(
    access_token: &str,
    beatmap_id: i64,
    user_id: i64,
    ruleset: &str,
) -> Result<Option<Value>, String> {
    let url = format!("{API}/beatmaps/{beatmap_id}/scores/users/{user_id}");
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .query(&[("legacy_only", "0"), ("mode", ruleset)])
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !status.is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("beatmap user score HTTP {status}: {t}"));
    }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(Some(v))
}

/// Mean `pp` among returned scores (approximates “average PP people get when this is a top play”).
pub fn avg_pp_from_scores_json(value: &Value) -> Option<f64> {
    let scores = value.get("scores")?.as_array()?;
    if scores.is_empty() {
        return None;
    }
    let mut sum = 0.0_f64;
    let mut n = 0usize;
    for s in scores {
        if let Some(pp) = s.get("pp").and_then(|x| x.as_f64()) {
            if pp.is_finite() && pp >= 0.0 {
                sum += pp;
                n += 1;
            }
        }
    }
    if n == 0 {
        None
    } else {
        Some(sum / n as f64)
    }
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

/// Friends list (`friends.read` scope).
///
/// Sends `x-api-version` so the server returns `UserRelation` entries (with `target`) per osu-web ≥ 20241022.
pub async fn api_friends(access_token: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{API}/friends"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .header("x-api-version", "20241022")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("/friends failed: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// User profile (compact or full depending on API).
pub async fn api_user(access_token: &str, user_id: i64) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{API}/users/{user_id}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("/users failed: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Per-ruleset statistics (e.g. mode `osu`, `taiko`).
pub async fn api_user_ruleset_stats(
    access_token: &str,
    user_id: i64,
    mode: &str,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{API}/users/{user_id}/{mode}"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("/users/:mode stats failed: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Recent scores for performance snapshots / comparisons.
pub async fn api_user_recent_scores(
    access_token: &str,
    user_id: i64,
    limit: u32,
    mode: &str,
) -> Result<Value, String> {
    let lim = limit.min(100).max(1);
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{API}/users/{user_id}/scores/recent"))
        .query(&[("limit", lim.to_string()), ("mode", mode.to_string())])
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().await.unwrap_or_default();
        return Err(format!("/scores/recent failed: {t}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Best or first-place scores (`GET /api/v2/users/{user}/scores/{best|first}`).
pub async fn api_user_scores(
    access_token: &str,
    user_id: i64,
    score_type: &str,
    limit: u32,
    mode: &str,
    offset: Option<u32>,
) -> Result<Value, String> {
    let t = score_type.trim();
    if t != "best" && t != "first" {
        return Err("score_type must be \"best\" or \"first\".".into());
    }
    let lim = limit.min(100).max(1);
    let client = reqwest::Client::new();
    let mut req = client
        .get(format!("{API}/users/{user_id}/scores/{t}"))
        .query(&[
            ("limit", lim.to_string()),
            ("mode", mode.to_string()),
        ])
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json");
    if let Some(off) = offset {
        req = req.query(&[("offset", off.to_string())]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("/users/scores/{t} failed: {body}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

/// Download bytes from a single mirror URL (redirects followed).
pub async fn download_bytes_from_url(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_429 = false;
    for attempt in 0u32..4u32 {
        let res = client
            .get(url)
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
