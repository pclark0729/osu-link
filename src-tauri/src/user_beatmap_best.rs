//! User best score per beatmap (`GET /beatmaps/{id}/scores/users/{user}`).

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

async fn fetch_one(
    token: &str,
    beatmap_id: i64,
    user_id: i64,
    ruleset: &str,
) -> (i64, Option<Value>) {
    match crate::osu_api::api_beatmap_user_best(token, beatmap_id, user_id, ruleset).await {
        Ok(v) => (beatmap_id, v),
        Err(_) => (beatmap_id, None),
    }
}

/// For each beatmap id: `Some(score)` from API, `None` when no score or request failed.
pub async fn get_user_bests_batch(
    token: &str,
    beatmap_ids: &[i64],
    user_id: i64,
    ruleset: &str,
) -> HashMap<i64, Option<Value>> {
    let mut ids: Vec<i64> = beatmap_ids.iter().copied().filter(|&x| x > 0).collect();
    ids.sort_unstable();
    ids.dedup();

    let sem = Arc::new(tokio::sync::Semaphore::new(4));
    let mut join_set = tokio::task::JoinSet::new();
    let rs = ruleset.to_string();
    let tok = token.to_string();

    for id in ids {
        let sem = sem.clone();
        let ruleset_clone = rs.clone();
        let tok_clone = tok.clone();
        join_set.spawn(async move {
            let Ok(permit) = sem.acquire().await else {
                return (id, None);
            };
            let _permit = permit;
            fetch_one(&tok_clone, id, user_id, &ruleset_clone).await
        });
    }

    let mut out: HashMap<i64, Option<Value>> = HashMap::new();
    while let Some(joined) = join_set.join_next().await {
        if let Ok((id, v)) = joined {
            out.insert(id, v);
        }
    }
    out
}
