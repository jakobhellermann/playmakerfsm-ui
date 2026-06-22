import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fmtValue } from './fmt';
import { toPseudocode } from './pseudo';
import type { FsmModel, IndexEntry, Param } from './model';

// Runs against the real content store (the gitignored static/data symlink → ../playmakerfsm/out).
// Skips cleanly in environments without the data (e.g. fresh CI).
const dir = resolve('static/data/hk');
const hasData = existsSync(resolve(dir, 'index.json'));

const readModel = (hash: string): FsmModel =>
	JSON.parse(readFileSync(resolve(dir, 'content', `${hash}.json`), 'utf8'));

describe.skipIf(!hasData)('real store (hk)', () => {
	const index: IndexEntry[] = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8'));

	// deterministic pick: distinct content hashes, ordered by (name, hash)
	const seen = new Set<string>();
	const distinct = [...index]
		.sort((a, b) => a.name.localeCompare(b.name) || a.hash.localeCompare(b.hash))
		.filter((e) => (seen.has(e.hash) ? false : (seen.add(e.hash), true)));

	for (const e of distinct.slice(0, 3)) {
		it(`pseudocode snapshot: ${e.name}`, () => {
			expect(toPseudocode(readModel(e.hash))).toMatchSnapshot();
		});
	}

	// drift guard: a `type` produced by the Rust model but missing from model.ts/fmt.ts would make
	// fmtValue fall through its switch and return undefined — scan a broad sample to catch that.
	it('fmtValue produces a non-empty string for every param across a wide sample', () => {
		const walk = (params: Param[]) => {
			for (const p of params) {
				const s = fmtValue(p.value);
				expect(typeof s, `${p.type_name} (${(p.value as { type?: string }).type})`).toBe('string');
				expect(s.length).toBeGreaterThan(0);
				if (p.value.type === 'List') walk(p.value.value);
			}
		};
		for (const e of distinct.slice(0, 100)) {
			const m = readModel(e.hash);
			for (const st of m.states) for (const a of st.actions) walk(a.params);
		}
	});
});
