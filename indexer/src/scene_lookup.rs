//! Build a `file_label → scene_name` lookup from BuildSettings (HK) and the addressables
//! catalog (SS). Mirrors `rabex-cli`'s `ctx::scenes()` but only returns the name map.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use rabex_env::Environment;
use rabex_env::addressables::binary_catalog::resource_providers;
use rabex_env::resolver::EnvResolver;

const SCENE_INSTANCE_CLASS: &str = "UnityEngine.ResourceManagement.ResourceProviders.SceneInstance";

/// `file_label → scene_name` for all scenes in the game.
///
/// For HK (plain level files): `level0 → "Menu_Title"` from BuildSettings.
/// For SS (addressables bundles): `scenes_scenes_scenes/bone_east_10.bundle → "Bone_East_10"`
/// from the addressables catalog.
pub fn build_scene_lookup<R: EnvResolver, P: rabex_env::rabex::typetree::TypeTreeProvider>(
    env: &Environment<R, P>,
) -> Result<BTreeMap<String, String>> {
    let mut lookup = BTreeMap::new();

    // Built-in scenes: BuildSettings lists scene paths; the build index gives the `levelN` name.
    let build_settings = env.build_settings()?;
    for (index, name) in build_settings.scene_names().enumerate() {
        lookup.insert(format!("level{index}"), name.to_owned());
    }

    // Addressables scenes: catalog entries of type SceneInstance whose ASSET_BUNDLE dependency
    // gives us the bundle path (relative to the build folder).
    if let Some(addressables) = env.addressables()? {
        let build_folder = addressables.build_folder();
        for loc in addressables.resource_locations(&env.game_files)? {
            if loc.provider_id.as_str() != resource_providers::BUNDLED_ASSET
                || loc.type_.m_ClassName.as_str() != SCENE_INSTANCE_CLASS
            {
                continue;
            }
            let Some(name) = Path::new(loc.primary_key.as_str())
                .file_stem()
                .and_then(|s| s.to_str())
            else {
                continue;
            };
            if lookup.contains_key(name) {
                continue;
            }
            // The scene's bundle is its ASSET_BUNDLE dependency.
            if let Some(dep) = loc
                .dependencies
                .iter()
                .find(|dep| dep.provider_id.as_str() == resource_providers::ASSET_BUNDLE)
            {
                let path = addressables.evaluate_string(&dep.internal_id);
                let relative = Path::new(&path)
                    .strip_prefix(&build_folder)
                    .unwrap_or(Path::new(&path));
                lookup.insert(relative.to_string_lossy().to_string(), name.to_owned());
            }
        }
    }

    Ok(lookup)
}
