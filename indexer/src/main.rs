mod config;
mod enum_map;
mod scan;
mod scene_lookup;

use std::path::Path;

use anyhow::{Context as _, Result};

use config::Config;

fn main() -> Result<()> {
	let config: Config =
		serde_json::from_str(&std::fs::read_to_string("indexer/config.json").context("config.json")?)?;

	for game in &config.games {
		let start = std::time::Instant::now();
		eprintln!("\n=== {} ===", game.slug);

		let out_dir = Path::new("static/data").join(&game.slug);
		let result = scan::scan_game(&game.path, &out_dir)?;

		let index_path = out_dir.join("index.json");
		std::fs::write(&index_path, serde_json::to_vec_pretty(&result.entries)?)?;

		let scenes_path = out_dir.join("scenes.json");
		std::fs::write(&scenes_path, serde_json::to_vec_pretty(&result.scene_names)?)?;

		eprintln!(
			"{} fsms → {} distinct models, index in {} ({:.1}s)",
			result.entries.len(),
			result.written.len(),
			index_path.display(),
			start.elapsed().as_secs_f64()
		);
	}

	Ok(())
}
