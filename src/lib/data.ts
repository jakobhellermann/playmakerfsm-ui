import { base } from '$app/paths';
import type { FsmModel, IndexEntry } from './model';

export type Game = 'hk' | 'ss';

export const GAMES: { id: Game; label: string }[] = [
	{ id: 'hk', label: 'Hollow Knight' },
	{ id: 'ss', label: 'Silksong' }
];

const indexCache = new Map<Game, Promise<IndexEntry[]>>();

export function loadIndex(game: Game): Promise<IndexEntry[]> {
	let p = indexCache.get(game);
	if (!p) {
		p = fetch(`${base}/data/${game}/index.json`).then((r) => {
			if (!r.ok) throw new Error(`index ${game}: ${r.status}`);
			return r.json();
		});
		indexCache.set(game, p);
	}
	return p;
}

export function loadModel(game: Game, hash: string): Promise<FsmModel> {
	return fetch(`${base}/data/${game}/content/${hash}.json`).then((r) => {
		if (!r.ok) throw new Error(`model ${hash}: ${r.status}`);
		return r.json();
	});
}
