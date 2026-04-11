//! Average PP from osu! global leaderboard scores (`pp` field on top scores).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::Value;

fn avg_cache() -> &'static Mutex<HashMap<(i64, String), f64>> {
    static CACHE: OnceLock<Mutex<HashMap<(i64, String), f64>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn fetch_one(token: &str, beatmap_id: i64, ruleset: &str) -> Option<f64> {
    let key = (beatmap_id, ruleset.to_string());
    if let Ok(guard) = avg_cache().lock() {
        if let Some(&pp) = guard.get(&key) {
            return Some(pp);
        }
    }

    let json: Value = crate::osu_api::api_beatmap_scores(token, beatmap_id, ruleset, 100)
        .await
        .ok()?;
    let avg = crate::osu_api::avg_pp_from_scores_json(&json)?;
    if let Ok(mut guard) = avg_cache().lock() {
        guard.insert(key, avg);
    }
    Some(avg)
}

/// For each beatmap id: `Some(avg)` when scores exist, `None` when there are no PP scores or the request failed.
pub async fn get_avg_pp_batch(
    token: &str,
    beatmap_ids: &[i64],
    ruleset: &str,
) -> HashMap<i64, Option<f64>> {
    let mut ids: Vec<i64> = beatmap_ids.iter().copied().filter(|&x| x > 0).collect();
    ids.sort_unstable();
    ids.dedup();

    let mut out: HashMap<i64, Option<f64>> = HashMap::with_capacity(ids.len());
    let mut pending: Vec<i64> = Vec::new();

    for id in ids {
        let key = (id, ruleset.to_string());
        if let Ok(guard) = avg_cache().lock() {
            if let Some(&pp) = guard.get(&key) {
                out.insert(id, Some(pp));
                continue;
            }
        }
        pending.push(id);
    }

    let sem = Arc::new(tokio::sync::Semaphore::new(4));
    let mut join_set = tokio::task::JoinSet::new();
    let rs = ruleset.to_string();
    for id in pending {
        let sem = sem.clone();
        let tok = token.to_string();
        let ruleset_clone = rs.clone();
        join_set.spawn(async move {
            let Ok(permit) = sem.acquire().await else {
                return (id, None);
            };
            let _permit = permit;
            let v = fetch_one(&tok, id, &ruleset_clone).await;
            (id, v)
        });
    }

    while let Some(joined) = join_set.join_next().await {
        match joined {
            Ok((id, Some(pp))) => {
                out.insert(id, Some(pp));
            }
            Ok((id, None)) => {
                out.insert(id, None);
            }
            Err(_) => {}
        }
    }

    out
}
