import { describe, expect, it } from 'vitest';
import { groupNamedScenes, groupOtherFiles, otherGroupKey, type SceneRowLike } from './scenes';

const row = (name: string, file = name): SceneRowLike => ({ name, file });
/** compact view of a grouping result for full-equality assertions */
const shape = (gs: ReturnType<typeof groupNamedScenes<SceneRowLike>>) =>
	gs.map((g) => ({ prefix: g.prefix, group: g.group, names: g.items.map((i) => i.name) }));

describe('groupNamedScenes', () => {
	it('groups an area with numbered scenes, pulling in non-numbered siblings', () => {
		// Ant_Merchant / Ant_Queen have no number but belong to the Ant area (Ant_02 exists)
		const groups = groupNamedScenes(
			['Ant_02', 'Ant_03', 'Ant_Merchant', 'Ant_Queen', 'Ant_04_left'].map((n) => row(n))
		);
		expect(shape(groups)).toEqual([
			{
				prefix: 'Ant',
				group: true,
				names: ['Ant_02', 'Ant_03', 'Ant_04_left', 'Ant_Merchant', 'Ant_Queen']
			}
		]);
	});

	it('groups a lone numbered scene (Tutorial_01) but not a lone unnumbered one', () => {
		// files default to the name here, so groups order alphabetically: BetaEnd < Quit < Tutorial
		const groups = groupNamedScenes([row('Tutorial_01'), row('Quit_To_Menu'), row('BetaEnd')]);
		expect(shape(groups)).toEqual([
			{ prefix: 'BetaEnd', group: false, names: ['BetaEnd'] },
			{ prefix: 'Quit', group: false, names: ['Quit_To_Menu'] },
			{ prefix: 'Tutorial', group: true, names: ['Tutorial_01'] }
		]);
	});

	it('orders groups and members numerically by file', () => {
		const groups = groupNamedScenes(
			[
				{ name: 'Bone_10', file: 'level10' },
				{ name: 'Bone_2', file: 'level2' },
				{ name: 'Abyss_01', file: 'level1' }
			].map((r) => r)
		);
		expect(shape(groups)).toEqual([
			{ prefix: 'Abyss', group: true, names: ['Abyss_01'] },
			{ prefix: 'Bone', group: true, names: ['Bone_2', 'Bone_10'] }
		]);
	});
});

describe('otherGroupKey', () => {
	it('takes the token before the first underscore for asset bundles', () => {
		expect(otherGroupKey('localpoolprefabs_assets_areasong.bundle')).toBe('localpoolprefabs');
		expect(otherGroupKey('enemycorpses_assets_areawisp.bundle')).toBe('enemycorpses');
		expect(otherGroupKey('coremanagers_assets__gamecameras.bundle')).toBe('coremanagers');
	});

	it('strips a trailing number when there is no underscore', () => {
		expect(otherGroupKey('sharedassets176.assets')).toBe('sharedassets');
		expect(otherGroupKey('resources.assets')).toBe('resources');
		expect(otherGroupKey('globalgamemanagers')).toBe('globalgamemanagers');
	});
});

describe('groupOtherFiles', () => {
	it('groups files sharing a key, leaves singletons flat', () => {
		const groups = groupOtherFiles([
			row('sharedassets1', 'sharedassets176.assets'),
			row('sharedassets2', 'sharedassets32.assets'),
			row('resources', 'resources.assets')
		]);
		expect(groups.map((g) => ({ prefix: g.prefix, group: g.group, n: g.items.length }))).toEqual([
			{ prefix: 'resources', group: false, n: 1 },
			{ prefix: 'sharedassets', group: true, n: 2 }
		]);
	});
});
