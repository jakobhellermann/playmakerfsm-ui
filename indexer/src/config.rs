//! Config + shared types.

use rabex::objects::pptr::PathId;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct Config {
    pub games: Vec<GameConfig>,
}

#[derive(Deserialize)]
pub struct GameConfig {
    pub slug: String,
    #[allow(dead_code)]
    pub label: String,
    pub path: String,
}

#[derive(Serialize)]
pub struct Entry {
    pub file: String,
    pub path_id: PathId,
    pub name: String,
    pub game_object: String,
    pub hash: String,
}
