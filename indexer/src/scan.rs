//! Scan a game's serialized files for PlayMakerFSM components, decode each FSM, and collect
//! content-addressed index entries.

use std::collections::BTreeMap;
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeSet;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context as _, Result};
use playmakerfsm::model::{Context as FsmContext, decode_fsm};
use playmakerfsm::raw::*;
use rabex::files::SerializedFile;
use rabex_env::addressables::ArchivePath;
use rabex_env::qualify::Qualifier;
use rabex_env::rabex::tpk::TpkTypeTreeBlob;
use rabex_env::rabex::typetree::typetree_cache::sync::TypeTreeCache;
use rabex_env::resolver::EnvResolver;
use rabex_env::unity::types::MonoBehaviour;
use rabex_env::{Environment, resolver::GameFiles};
use rayon::prelude::*;

use crate::config::Entry;
use crate::enum_map::{bake_enums, build_enum_map};
use crate::scene_lookup;

/// Output of a single game scan: the index entries and the set of content hashes written.
pub struct ScanResult {
	pub entries: Vec<Entry>,
	pub written: BTreeSet<String>,
	pub scene_names: BTreeMap<String, String>,
}

/// Scan one game: find all PlayMakerFSM components, decode them, write content-addressed
/// JSON files, and return the index entries.
pub fn scan_game(steam_path: &str, out_dir: &Path) -> Result<ScanResult> {
	let path = shellexpand::tilde(steam_path);
	let game_files = GameFiles::probe(path.as_ref())
		.with_context(|| format!("could not probe game at {path}"))?;
	let tpk = TypeTreeCache::new(TpkTypeTreeBlob::embedded());
	let env = Environment::new(game_files, tpk);

	let enum_map = build_enum_map(&env.game_files.game_dir.join("Managed"));
	eprintln!("enum map: {} action fields", enum_map.len());

	let scene_names = scene_lookup::build_scene_lookup(&env)?;
	eprintln!("scenes: {} names", scene_names.len());

	let plain: Vec<PathBuf> = env.game_files.serialized_files()?;
	let bundles: Vec<PathBuf> = env.addressables_bundles()?;
	eprintln!("scanning {} plain files + {} bundles...", plain.len(), bundles.len());

	let content_dir = out_dir.join("content");
	std::fs::create_dir_all(&content_dir)?;

	let written: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
	let entries: Mutex<Vec<Entry>> = Mutex::new(Vec::new());

	let scan = |file_label: String, handle: &rabex_env::handle::SerializedFileHandle| {
		let Ok(scripts) = handle.scripts::<MonoBehaviour>("PlayMakerFSM") else {
			return;
		};
		let mut qualifier = Qualifier::new(handle);
		let mut ctx = FsmContext::new(handle);
		let mut local: Vec<Entry> = Vec::new();

		for mb in scripts {
			let path_id = mb.path_id();
			let label = qualifier
				.qualify_local(path_id)
				.map(|p| p.to_string())
				.unwrap_or_default();
			let game_object = label.rsplit_once('@').map(|(go, _)| go).unwrap_or(&label).to_string();

			let Ok(pm) = mb.cast::<PlayMakerFSM>().read() else {
				continue;
			};
			// If the component references a template, the template's FSM *is* the runtime FSM —
			// PlayMakerFSM.InitTemplate() replaces the component FSM entirely, keeping only the
			// component's variables and name. Always resolve when the PPtr is set.
			let template = (pm.fsmTemplate.m_PathID != 0)
				.then(|| handle.deref_read::<FsmTemplate>(pm.fsmTemplate).ok())
				.flatten();
			let mut model = decode_fsm(template.as_ref().map_or(&pm.fsm, |t| &t.fsm), &mut ctx);
			if template.is_some() {
				model.name = &pm.fsm.name;
			}
			bake_enums(&mut model, &enum_map);
			let Ok(json) = serde_json::to_vec(&model) else {
				continue;
			};

			let mut hasher = DefaultHasher::new();
			json.hash(&mut hasher);
			let hash = format!("{:016x}", hasher.finish());

			let is_new = written.lock().unwrap().insert(hash.clone());
			if is_new {
				let _ = std::fs::write(content_dir.join(format!("{hash}.json")), &json);
			}
			local.push(Entry {
				file: file_label.clone(),
				path_id,
				name: pm.fsm.name.to_string(),
				game_object,
				hash,
			});
		}

		if !local.is_empty() {
			eprintln!("  {file_label}: {} fsms", local.len());
		}
		entries.lock().unwrap().extend(local);
	};

	// Plain serialized files (levelN, *.assets, globalgamemanagers)
	plain.par_iter().for_each(|file| {
		let Ok(handle) = env.load_serialized(file) else {
			return;
		};
		scan(file.to_string_lossy().to_string(), &handle);
	});

	// Addressables bundles — each contains multiple serialized files (main CAB + .sharedAssets).
	// The file label is the bundle path (e.g. `scenes_scenes_scenes/bone_east_10.bundle`), not the
	// internal archive path — that's what the scene lookup uses and what the UI displays.
	bundles.par_iter().for_each(|bundle_path| {
		let file_label = bundle_path.to_string_lossy().to_string();
		let Ok(bundle) = env.load_addressables_bundle(bundle_path) else {
			return;
		};
		let Some(bundle_id) = bundle.main_serializedfile().map(|f| f.path.clone()) else {
			return;
		};
		for entry in bundle.serialized_files() {
			let archive_path = ArchivePath::new(&bundle_id, &entry.path);
			let Ok(data) = bundle.read_at_entry(entry) else {
				continue;
			};
			let Ok(mut serialized) = SerializedFile::from_reader(&mut Cursor::new(&data)) else {
				continue;
			};
			if let Ok(version) = env.unity_version() {
				serialized.m_UnityVersion.get_or_insert(version.clone());
			}
			let handle = env.insert_cache(archive_path.to_string().into(), serialized, data.into());
			scan(file_label.clone(), &handle);
		}
	});

	let mut entries = entries.into_inner().unwrap();
	let written = written.into_inner().unwrap();
	entries.sort_by(|a, b| (&a.name, &a.file, a.path_id).cmp(&(&b.name, &b.file, b.path_id)));

	// Prune orphaned content files from earlier runs
	let mut pruned = 0usize;
	for entry in std::fs::read_dir(&content_dir)?.flatten() {
		let path = entry.path();
		if path.extension().and_then(|e| e.to_str()) != Some("json") {
			continue;
		}
		let referenced = path
			.file_stem()
			.and_then(|s| s.to_str())
			.is_some_and(|stem| written.contains(stem));
		if !referenced {
			std::fs::remove_file(&path)?;
			pruned += 1;
		}
	}

	eprintln!(
		"{} fsms → {} distinct models in {} ({pruned} stale pruned), index in {} ({:.1}s)",
		entries.len(),
		written.len(),
		content_dir.display(),
		out_dir.join("index.json").display(),
		0.0,
	);

	std::mem::forget(env);
	Ok(ScanResult { entries, written, scene_names })
}
