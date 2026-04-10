use serde::{Deserialize, Serialize};
use std::fs;

use crate::settings::app_storage_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    pub id: String,
    pub beatmapset_id: i64,
    pub artist: String,
    pub title: String,
    pub creator: String,
    pub cover_url: Option<String>,
    /// pending | downloading | imported | error
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeatmapCollection {
    pub id: String,
    pub name: String,
    pub items: Vec<CollectionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionStore {
    #[serde(default)]
    pub active_collection_id: Option<String>,
    pub collections: Vec<BeatmapCollection>,
}

fn collections_path() -> std::path::PathBuf {
    app_storage_dir().join("collections.json")
}

fn new_col_id() -> String {
    use rand::Rng;
    let n: u64 = rand::thread_rng().gen();
    format!("col-{n:x}")
}

fn default_store() -> CollectionStore {
    let id = new_col_id();
    CollectionStore {
        active_collection_id: Some(id.clone()),
        collections: vec![BeatmapCollection {
            id,
            name: "My collection".into(),
            items: vec![],
        }],
    }
}

/// Legacy file was a bare JSON array of items.
fn try_migrate_legacy(bytes: &[u8]) -> Option<CollectionStore> {
    let items: Vec<CollectionItem> = serde_json::from_slice(bytes).ok()?;
    let id = new_col_id();
    Some(CollectionStore {
        active_collection_id: Some(id.clone()),
        collections: vec![BeatmapCollection {
            id,
            name: "My collection".into(),
            items,
        }],
    })
}

pub fn load_collection_store() -> CollectionStore {
    let path = collections_path();
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(mut store) = serde_json::from_slice::<CollectionStore>(&bytes) {
            if store.collections.is_empty() {
                return default_store();
            }
            if store.active_collection_id.is_none()
                || !store
                    .collections
                    .iter()
                    .any(|c| Some(&c.id) == store.active_collection_id.as_ref())
            {
                store.active_collection_id = Some(store.collections[0].id.clone());
            }
            return store;
        }
        if let Some(migrated) = try_migrate_legacy(&bytes) {
            let _ = save_collection_store(&migrated);
            return migrated;
        }
    }
    default_store()
}

pub fn save_collection_store(store: &CollectionStore) -> Result<(), String> {
    let dir = app_storage_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let j = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(collections_path(), j).map_err(|e| e.to_string())
}
