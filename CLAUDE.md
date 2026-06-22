# playmakerfsm-ui

Static SvelteKit site for browsing the PlayMaker FSMs of Hollow Knight and Silksong. It renders the
content-addressed JSON store produced by the sibling Rust crate `../playmakerfsm` (see its
`examples/content_index.rs` / `make content`).

## Commands

- `pnpm dev` — dev server (`--host` to expose on LAN).
- `pnpm build` — static export (adapter-static, SPA with `404.html` fallback) into `build/`.
- `pnpm check` — `svelte-check` (types).
- `pnpm test` — vitest. Unit tests for the pure formatters (`fmt.ts`, `pseudo.ts`); `store.test.ts`
  snapshots a few FSMs and scans 100 real models to catch fmt/`model.ts` drift (skips if the data
  symlink is absent). Re-snapshot with `pnpm exec vitest -u` after intended output changes.
- `pnpm fmt` / `pnpm fmt:check` — oxfmt (config in `.oxfmtrc.json`; formats `.svelte` too via `svelte: true`).
- `pnpm lint` — oxlint.

Run `pnpm fmt` and keep `check`/`lint` clean before committing. Commit often with short messages
(this repo uses jj; no co-author/AI trailers).

## Data

- Lives in `../playmakerfsm/out/<game>/`: `index.json` (one entry per FSM reference:
  `file`, `path_id`, `name`, `game_object`, `hash`) + `content/<hash>.json` (the serialized model,
  deduped by content hash).
- `static/data` is a gitignored symlink to `../playmakerfsm/out`, served at `/data/`. Recreate with
  `ln -sfn ../../playmakerfsm/out static/data` if missing.
- `<game>` is `hk` (Hollow Knight) or `ss` (Silksong). Content is **immutable** (content-addressed),
  so TanStack Query uses `staleTime: Infinity` — never refetch.

## Architecture

- **Navigation state is the URL.** Main page (`/`): `?game&scene&go` drive a scene → game-object →
  FSM drill-down; detail (`/fsm/[game]/[hash]`): `?mode`. Reload restores the exact view.
- `src/lib/data.ts` — fetchers + `Game` type + name helpers (`sceneLabel` strips the SS
  `scenes_scenes_scenes/…​.bundle` wrapper; `goLeaf`).
- `src/lib/model.ts` — **hand-written** TS mirror of the Rust `playmakerfsm::model` JSON. The Rust
  enums use mixed serde taggings, mirrored exactly: `{type,value}` (ParamValue/Value/VarValue),
  `{kind,value}` (StrValue/EnumValue/ArrayValue), `{kind,target}` (RefTarget), external (GoRef). If
  the Rust model changes, update this by hand against a real `content/*.json`.
- `src/lib/fmt.ts` — single-line value formatting, ported from `playmakerfsm`'s `prettify` example.
- `src/lib/glossary.ts` — hover-text definitions **sourced from the PlayMaker decompile**, not
  guessed. Decomp lives at
  `~/.steamapps/Hollow Knight/.../Data/Managed/decomp/playmaker`. Look things up there; never guess
  PlayMaker semantics.
- `src/lib/views/{RawView,PseudoView,GraphView}.svelte` — the three detail modes. Graph uses
  `@dagrejs/dagre` for layout + plain SVG (fit-to-screen, +/-, drag-to-pan).

## Conventions

- Svelte 5 runes; SvelteKit config is in `vite.config.ts` (the `sveltekit()` plugin), not
  `svelte.config.js`.
- `base` path comes from `BASE_PATH` for GitHub Pages subdirectory hosting.
