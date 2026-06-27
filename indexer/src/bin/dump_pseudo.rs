//! Dump every FSM of a game to pseudocode text files (one per unique FSM).
//!
//! Reads the content-addressed store produced by the indexer (`just index` +
//! `just unpack-data`) from `static/data/<slug>/`. Identical FSMs (same content hash)
//! collapse to one file. Filenames start with the FSM name; if that collides,
//! game-object path components are appended until unique, then the scene name.
//!
//! Usage: `cargo run --release --bin dump-pseudo -- [slug]...` (default: all games in config)

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use anyhow::{Context as _, Result};
use serde::Deserialize;
use serde_json::Value;

// ── types for reading the index ──────────────────────────────────────────────

#[derive(Deserialize)]
struct Config {
    games: Vec<GameConfig>,
}

#[derive(Deserialize)]
struct GameConfig {
    slug: String,
    #[allow(dead_code)]
    path: String,
}

#[derive(Deserialize, Clone)]
struct Entry {
    file: String,
    name: String,
    game_object: String,
    hash: String,
}

// ── value formatting (ported from src/lib/fmt.ts) ────────────────────────────

fn short(cls: &str) -> &str {
    cls.rsplit('.').next().unwrap_or(cls)
}

/// JSON-quoted string: `"hello"` (matches the TS `q()` / `JSON.stringify`).
fn q(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("{s:?}"))
}

fn fmt_value(v: &Value) -> String {
    let ty = v["type"].as_str().unwrap_or("");
    let val = &v["value"];
    match ty {
        "Bool" => val.as_bool().unwrap_or(false).to_string(),
        "Int" => val.as_i64().unwrap_or(0).to_string(),
        "Float" => {
            let f = val.as_f64().unwrap_or(0.0);
            format!("{f}")
        }
        "Vector" => {
            let comps = val.as_array().map(|a| {
                a.iter()
                    .map(|c| format!("{}", c.as_f64().unwrap_or(0.0)))
                    .collect::<Vec<_>>()
                    .join(", ")
            });
            format!("({})", comps.unwrap_or_default())
        }
        "PackedVar" => match val {
            Value::Null => "(unset)".into(),
            _ => format!("var {}", q(val.as_str().unwrap_or(""))),
        },
        "Event" => match val {
            Value::Null => "(none)".into(),
            _ => format!("→{}", q(val.as_str().unwrap_or(""))),
        },
        "Str" => q(val.as_str().unwrap_or("")),
        "FsmString" => fmt_str(val),
        "Owner" | "GameObject" | "Object" => fmt_go_ref(val),
        "Var" => fmt_var(val),
        "EventTarget" => fmt_event_target(val),
        "Function" => fmt_function(val),
        "Template" => fmt_template(val),
        "Enum" => fmt_enum(val),
        "EnumMember" => val.as_str().unwrap_or("").to_string(),
        "Array" => fmt_array(val),
        "Property" => fmt_property(val),
        "AnimCurve" => {
            let n = val["keys"].as_array().map(|a| a.len()).unwrap_or(0);
            format!("curve[{n} keys]")
        }
        "List" => {
            let n = val.as_array().map(|a| a.len()).unwrap_or(0);
            format!("[{n} elems]")
        }
        "Pptr" => fmt_object_ref(val),
        "Raw" => {
            let n = val.as_array().map(|a| a.len()).unwrap_or(0);
            format!("({n}B)")
        }
        _ => format!("{val}"),
    }
}

fn fmt_str(s: &Value) -> String {
    match s["kind"].as_str() {
        Some("Var") => format!("var {}", q(s["value"].as_str().unwrap_or(""))),
        _ => q(s["value"].as_str().unwrap_or("")),
    }
}

fn fmt_enum(e: &Value) -> String {
    match e["kind"].as_str() {
        Some("Var") => format!("var {}", q(e["value"].as_str().unwrap_or(""))),
        Some("Named") => {
            let name = e["value"]["enum_name"].as_str().unwrap_or("");
            let val = e["value"]["value"].as_i64().unwrap_or(0);
            format!("{}({val})", short(name))
        }
        _ => e["value"].as_i64().unwrap_or(0).to_string(),
    }
}

fn fmt_array(a: &Value) -> String {
    match a["kind"].as_str() {
        Some("Var") => format!("var {}", q(a["value"].as_str().unwrap_or(""))),
        _ => {
            let n = a["value"].as_array().map(|a| a.len()).unwrap_or(0);
            format!("array[{n} elems]")
        }
    }
}

fn fmt_var(v: &Value) -> String {
    match v["type"].as_str() {
        Some("Var") => format!("var {}", q(v["value"].as_str().unwrap_or(""))),
        Some("Unset") => "(unset var)".into(),
        Some("Unused") => "(unused)".into(),
        Some("Float") => format!("{}", v["value"].as_f64().unwrap_or(0.0)),
        Some("Int") => v["value"].as_i64().unwrap_or(0).to_string(),
        Some("Bool") => v["value"].as_bool().unwrap_or(false).to_string(),
        Some("Str") => q(v["value"].as_str().unwrap_or("")),
        Some("Object") => fmt_object_ref(&v["value"]),
        Some("Vector") => {
            let comps = v["value"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|c| format!("{}", c.as_f64().unwrap_or(0.0)))
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            format!("({comps})")
        }
        Some("Enum") => format!("enum({})", v["value"].as_i64().unwrap_or(0)),
        Some("Array") => fmt_array(&v["value"]),
        _ => format!("{v}"),
    }
}

fn fmt_go_ref(r: &Value) -> String {
    if r.is_string() {
        return match r.as_str() {
            Some("SelfOwner") => "Self".into(),
            _ => r.as_str().unwrap_or("").into(),
        };
    }
    if let Some(name) = r.get("Var").and_then(|v| v.as_str()) {
        return format!("var {}", q(name));
    }
    if let Some(obj) = r.get("Object") {
        return fmt_object_ref(obj);
    }
    format!("{r}")
}

fn fmt_object_ref(r: &Value) -> String {
    let target = &r["target"];
    let kind = target["kind"].as_str().unwrap_or("");
    let loc = match kind {
        "Null" => return "<null>".into(),
        "Path" => target["target"].as_str().unwrap_or("").to_string(),
        "Loose" => {
            let name = target["target"]["name"].as_str();
            match name {
                Some(n) => n.to_string(),
                None => format!("loose:{}", target["target"]["id"].as_i64().unwrap_or(0)),
            }
        }
        _ => format!("{target}"),
    };
    match r["file"].as_str() {
        Some(file) if !file.is_empty() => format!("{loc} ({file})"),
        _ => loc,
    }
}

fn fmt_event_target(t: &Value) -> String {
    let kind = t["kind"].as_i64().unwrap_or(-1);
    let kind_str = match kind {
        0 => "Self",
        1 => "GameObject",
        2 => "GameObjectFSM",
        3 => "FSMComponent",
        4 => "BroadcastAll",
        5 => "HostFSM",
        6 => "SubFSMs",
        _ => "?",
    };
    let mut bits = Vec::new();
    if kind == 1 || kind == 2 {
        bits.push(fmt_go_ref(&t["game_object"]));
    }
    if let Some(name) = t["fsm_name"].as_str() {
        bits.push(format!("fsm={}", q(name)));
    }
    if bits.is_empty() {
        kind_str.into()
    } else {
        format!("{}({})", kind_str, bits.join(", "))
    }
}

fn fmt_function(f: &Value) -> String {
    let function = f["function"].as_str().unwrap_or("");
    let pt = f["parameter_type"].as_str().unwrap_or("");
    if pt.is_empty() || pt == "None" {
        return format!("{function}()");
    }
    match f.get("value") {
        Some(v) if !v.is_null() => format!("{function}({})", fmt_call_value(v)),
        // fall back to the bare type when the value couldn't be decoded
        _ => format!("{function}(<{pt}>)"),
    }
}

// the active parameter value of a FunctionCall (a `Value`, the variant decode.rs selects by type)
fn fmt_call_value(v: &Value) -> String {
    match v["type"].as_str() {
        Some("Var") => format!("var {}", q(v["value"].as_str().unwrap_or(""))),
        Some("Bool") => v["value"].as_bool().unwrap_or(false).to_string(),
        Some("Int") => v["value"].as_i64().unwrap_or(0).to_string(),
        Some("Float") => format!("{}", v["value"].as_f64().unwrap_or(0.0)),
        Some("Str") => q(v["value"].as_str().unwrap_or("")),
        Some("Vector") => {
            let comps = v["value"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|c| format!("{}", c.as_f64().unwrap_or(0.0)))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            format!("({comps})")
        }
        Some("Enum") => {
            let name = v["value"]["enum_name"].as_str().unwrap_or("");
            let val = v["value"]["value"].as_i64().unwrap_or(0);
            format!("{}({val})", short(name))
        }
        Some("Object") => fmt_object_ref(&v["value"]),
        Some("Array") => fmt_array(&v["value"]),
        _ => format!("{v}"),
    }
}

fn fmt_template(t: &Value) -> String {
    let vmap = |entries: &Value, arrow: &str| -> Vec<String> {
        entries
            .as_array()
            .into_iter()
            .flatten()
            .map(|o| {
                let var = o["variable"].as_str().unwrap_or("");
                if o["value"]["type"].as_str() == Some("Var") {
                    format!(
                        "{var}{arrow}var {}",
                        q(o["value"]["value"].as_str().unwrap_or(""))
                    )
                } else {
                    var.to_string()
                }
            })
            .collect()
    };
    let mut parts = vec![format!("template={}", t["template"])];
    for (label, vars) in [
        ("in", vmap(&t["inputs"], "<-")),
        ("out", vmap(&t["outputs"], "->")),
        ("vars", vmap(&t["overrides"], "=")),
    ] {
        if !vars.is_empty() {
            parts.push(format!("{label}[{}]", vars.join(", ")));
        }
    }
    if let Some(events) = t["events"].as_array().filter(|e| !e.is_empty()) {
        let evs: Vec<_> = events
            .iter()
            .map(|e| {
                format!(
                    "{}->{}",
                    e[0].as_str().unwrap_or(""),
                    e[1].as_str().unwrap_or("")
                )
            })
            .collect();
        parts.push(format!("events[{}]", evs.join(", ")));
    }
    parts.join(" ")
}

fn fmt_property(p: &Value) -> String {
    let ty = short(p["type_name"].as_str().unwrap_or(""));
    let prop = p["property"].as_str().unwrap_or("");
    if prop.is_empty() {
        ty.to_string()
    } else {
        format!("{ty}.{prop}")
    }
}

// ── pseudocode (ported from src/lib/pseudo.ts) ───────────────────────────────

fn args(params: &Value) -> String {
    params
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| {
            let name = p["name"].as_str().unwrap_or("");
            let v = fmt_value(&p["value"]);
            if name.is_empty() {
                v
            } else {
                format!("{name}={v}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn action_text(a: &Value) -> String {
    let cls = short(a["class"].as_str().unwrap_or(""));
    let line = format!("{}({})", cls, args(&a["params"]));
    if a["enabled"].as_bool().unwrap_or(true) {
        line
    } else {
        format!("{line}  // disabled")
    }
}

fn to_pseudocode(m: &Value) -> String {
    let mut out = Vec::new();
    out.push(format!("fsm {} {{", m["name"].as_str().unwrap_or("")));
    out.push(format!(
        "  start {}",
        m["start_state"].as_str().unwrap_or("")
    ));

    if let Some(globals) = m["global_transitions"].as_array() {
        for t in globals {
            out.push(format!(
                "  on {} → {}  // from any state",
                t["event"].as_str().unwrap_or(""),
                t["to_state"].as_str().unwrap_or("")
            ));
        }
    }

    if let Some(states) = m["states"].as_array() {
        for s in states {
            out.push(String::new());
            out.push(format!("  state {} {{", s["name"].as_str().unwrap_or("")));
            if let Some(actions) = s["actions"].as_array() {
                for a in actions {
                    out.push(format!("    {}", action_text(a)));
                }
            }
            if let Some(transitions) = s["transitions"].as_array() {
                for t in transitions {
                    out.push(format!(
                        "    on {} → {}",
                        t["event"].as_str().unwrap_or(""),
                        t["to_state"].as_str().unwrap_or("")
                    ));
                }
            }
            out.push("  }".into());
        }
    }

    out.push("}".into());
    out.join("\n")
}

// ── file naming: name → name + go components → name + go + scene ──────────────

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

/// Build a unique filename for each unique hash.
///
/// Starts with the FSM name; if that collides, appends game-object path components
/// (deepest first) until unique; if still not unique, appends the scene name.
/// Last resort: `:N` ordinal.
fn build_filenames(hashes: &[(String, String, String)]) -> Vec<String> {
    // (hash, game_object, scene) per entry. game_object components reversed (deepest first).
    let go_parts: Vec<Vec<&str>> = hashes
        .iter()
        .map(|(_, go, _)| go.split('/').filter(|s| !s.is_empty()).rev().collect())
        .collect();
    let max_go = go_parts.iter().map(|p| p.len()).max().unwrap_or(0);

    // candidate at level L: name + first L go components (deepest first), then + scene at L > max_go
    let candidate = |i: usize, level: usize| -> String {
        let name = &hashes[i].0;
        if level == 0 {
            return name.clone();
        }
        let parts = &go_parts[i];
        let go_level = level.min(max_go);
        let mut bits = vec![name.as_str()];
        for j in 0..go_level {
            if j < parts.len() {
                bits.push(parts[j]);
            }
        }
        if level > max_go {
            bits.push(&hashes[i].2); // scene
        }
        bits.join("_")
    };

    let mut assigned: Vec<Option<String>> = vec![None; hashes.len()];
    let mut pending: Vec<usize> = (0..hashes.len()).collect();
    let max_level = max_go + 2; // go components + scene + ordinal fallback

    for level in 0..=max_level {
        if pending.is_empty() {
            break;
        }
        // Group pending by candidate at this level
        let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for &i in &pending {
            groups.entry(candidate(i, level)).or_default().push(i);
        }
        let mut still_pending = Vec::new();
        for (cand, indices) in groups {
            if indices.len() == 1 {
                assigned[indices[0]] = Some(cand.clone());
            } else if level == max_level {
                // Last resort: ordinal suffix
                for (ord, &i) in indices.iter().enumerate() {
                    assigned[i] = Some(if ord == 0 {
                        cand.clone()
                    } else {
                        format!("{cand}:{ord}")
                    });
                }
            } else {
                still_pending.extend(indices);
            }
        }
        pending = still_pending;
    }

    assigned
        .into_iter()
        .map(|s| sanitize(&s.unwrap_or_default()))
        .collect()
}

// ── readme ─────────────────────────────────────────────────────────────────

fn write_readme(out_dir: &Path, games: &[(String, usize)]) -> Result<()> {
    let mut lines = vec![
        "# Pseudocode dump".into(),
        String::new(),
        "One `.txt` file per unique PlayMaker FSM (content-addressed, so identical ".into(),
        "FSMs collapse to one file). Generated by `just dump-pseudo` from the indexer's".into(),
        "content store (`static/data/<slug>/`). The format matches the website's".into(),
        "pseudocode view (plain `Action(name=value, …)` form, no simplifications).".into(),
        String::new(),
        "## File format".into(),
        String::new(),
        "Each file has a `#`-comment header followed by the pseudocode:".into(),
        String::new(),
        "```".into(),
        "# <fsm name>".into(),
        "# hash: <content hash>".into(),
        "# <N> location(s):".into(),
        "#   <scene> / <game_object>".into(),
        "#   ...".into(),
        String::new(),
        "fsm <name> {".into(),
        "  start <state>".into(),
        "  on <event> → <state>  // from any state".into(),
        String::new(),
        "  state <name> {".into(),
        "    <Action>(<param>=<value>, ...)".into(),
        "    on <event> → <state>".into(),
        "  }".into(),
        "}```".into(),
        String::new(),
        "Disabled actions get a `// disabled` suffix. Unset events show as `(none)`,".into(),
        "unbound variables as `(unset)` or `(unset var)`.".into(),
        String::new(),
        "## File naming".into(),
        String::new(),
        "Filenames start with the FSM name. If that collides, game-object path".into(),
        "components (deepest first) are appended until unique, then the scene name.".into(),
        "Last resort: a `:N` ordinal suffix.".into(),
        String::new(),
        "## Contents".into(),
        String::new(),
    ];
    for (slug, count) in games {
        lines.push(format!("- `{slug}/` — {count} unique FSMs"));
    }
    lines.push(String::new());

    std::fs::write(out_dir.join("README.md"), lines.join("\n"))?;
    Ok(())
}

// ── main ──────────────────────────────────────────────────────────────────────

fn dump_game(slug: &str, data_dir: &Path, out_dir: &Path) -> Result<usize> {
    let index: Vec<Entry> = serde_json::from_str(
        &std::fs::read_to_string(data_dir.join("index.json"))
            .with_context(|| format!("index.json for {slug}"))?,
    )?;

    // scene names (file → scene_name)
    let scenes: HashMap<String, String> = serde_json::from_str(
        &std::fs::read_to_string(data_dir.join("scenes.json"))
            .with_context(|| format!("scenes.json for {slug}"))?,
    )?;

    // Dedup by hash — identical FSMs collapse to one file.
    let mut by_hash: BTreeMap<String, Vec<&Entry>> = BTreeMap::new();
    for e in &index {
        by_hash.entry(e.hash.clone()).or_default().push(e);
    }

    // Build (name, game_object, scene) per unique hash, sorted by name for stable output.
    let mut hashes: Vec<(String, String, String, String)> = by_hash
        .iter()
        .map(|(hash, entries)| {
            let e = entries[0];
            let scene = scenes
                .get(&e.file)
                .cloned()
                .unwrap_or_else(|| e.file.clone());
            (e.name.clone(), e.game_object.clone(), scene, hash.clone())
        })
        .collect();
    hashes.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

    let names: Vec<(String, String, String)> = hashes
        .iter()
        .map(|(name, go, scene, _)| (name.clone(), go.clone(), scene.clone()))
        .collect();
    let filenames = build_filenames(&names);

    let out_game_dir = out_dir.join(slug);
    std::fs::create_dir_all(&out_game_dir)?;

    let content_dir = data_dir.join("content");
    let mut written = 0usize;

    for (i, (name, _go, _scene, hash)) in hashes.iter().enumerate() {
        let model: Value = serde_json::from_slice(
            &std::fs::read(content_dir.join(format!("{hash}.json")))
                .with_context(|| format!("content/{hash}.json"))?,
        )?;

        let entries = &by_hash[hash];

        let mut header = vec![
            format!("# {name}"),
            format!("# hash: {hash}"),
            format!("# {len} location(s):", len = entries.len()),
        ];
        for e in entries {
            let s = scenes.get(&e.file).map(|s| s.as_str()).unwrap_or(&e.file);
            header.push(format!("#   {s} / {}", e.game_object));
        }
        header.push(String::new());

        let text = format!("{}\n{}\n", header.join("\n"), to_pseudocode(&model));
        let path = out_game_dir.join(format!("{}.txt", filenames[i]));
        std::fs::write(&path, text)?;
        written += 1;
    }

    eprintln!("{slug}: {written} unique FSMs → {}", out_game_dir.display());
    Ok(written)
}

fn main() -> Result<()> {
    let config: Config =
        serde_json::from_str(&std::fs::read_to_string(Path::new("indexer/config.json"))?)?;

    let args: Vec<String> = std::env::args().skip(1).collect();
    let slugs: Vec<&str> = if args.is_empty() {
        config.games.iter().map(|g| g.slug.as_str()).collect()
    } else {
        args.iter().map(|s| s.as_str()).collect()
    };

    let root = Path::new("static/data");
    let out_dir = Path::new("out/pseudo");

    let mut summary: Vec<(String, usize)> = Vec::new();
    for slug in slugs {
        let data_dir = root.join(slug);
        if !data_dir.exists() {
            eprintln!(
                "{slug}: no data at {} — run `just unpack-data`",
                data_dir.display()
            );
            continue;
        }
        let count = dump_game(slug, &data_dir, out_dir)?;
        summary.push((slug.to_string(), count));
    }

    write_readme(out_dir, &summary)?;

    Ok(())
}
