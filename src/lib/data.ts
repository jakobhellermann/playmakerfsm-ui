import { base } from '$app/paths';
import type { FsmModel, IndexEntry } from './model';

export type Game = 'hk' | 'ss';

export const GAMES: { id: Game; label: string }[] = [
	{ id: 'hk', label: 'Hollow Knight' },
	{ id: 'ss', label: 'Silksong' }
];

export function isGame(s: string | null): s is Game {
	return s === 'hk' || s === 'ss';
}

// scene-name display/grouping helpers live in `scenes.ts` (kept free of `$app` so they're unit-testable)
export { sceneLabel } from './scenes';

/** leaf name of a `/`-separated GameObject hierarchy path */
export function goLeaf(path: string): string {
	return path === '' ? '(scene root)' : (path.split('/').pop() ?? path);
}

export async function fetchIndex(game: Game): Promise<IndexEntry[]> {
	const r = await fetch(`${base}/data/${game}/index.json`);
	if (!r.ok) throw new Error(`index ${game}: ${r.status}`);
	return r.json();
}

// optional human scene name per file, lifted from the referrer list (`make content` can't yet fold
// it into index.json). hk -> fsms_hk.json, ss -> fsms_hkss.json. Files without a `scene` (shared
// asset files, resources.assets, asset bundles) simply have no entry.
const SCENE_LIST: Record<Game, string> = { hk: 'fsms_hk', ss: 'fsms_hkss' };

export async function fetchSceneNames(game: Game): Promise<Map<string, string>> {
	const r = await fetch(`${base}/data/${SCENE_LIST[game]}.json`);
	if (!r.ok) throw new Error(`scene names ${game}: ${r.status}`);
	const j = (await r.json()) as { referrers: { file: string; scene?: string }[] };
	const m = new Map<string, string>();
	for (const ref of j.referrers) if (ref.scene && !m.has(ref.file)) m.set(ref.file, ref.scene);
	return m;
}

export async function fetchModel(game: Game, hash: string): Promise<FsmModel> {
	const r = await fetch(`${base}/data/${game}/content/${hash}.json`);
	if (!r.ok) throw new Error(`model ${hash}: ${r.status}`);
	return r.json();
}
