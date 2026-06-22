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

/** display name for a scene file (Silksong bundles carry a `scenes_scenes_scenes/…​.bundle` wrapper) */
export function sceneLabel(file: string): string {
	return file.replace(/^scenes_scenes_scenes\//, '').replace(/\.bundle$/, '');
}

/** leaf name of a `/`-separated GameObject hierarchy path */
export function goLeaf(path: string): string {
	return path === '' ? '(scene root)' : (path.split('/').pop() ?? path);
}

export async function fetchIndex(game: Game): Promise<IndexEntry[]> {
	const r = await fetch(`${base}/data/${game}/index.json`);
	if (!r.ok) throw new Error(`index ${game}: ${r.status}`);
	return r.json();
}

export async function fetchModel(game: Game, hash: string): Promise<FsmModel> {
	const r = await fetch(`${base}/data/${game}/content/${hash}.json`);
	if (!r.ok) throw new Error(`model ${hash}: ${r.status}`);
	return r.json();
}
