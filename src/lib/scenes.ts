/** display name for a scene file (Silksong bundles carry a `scenes_scenes_scenes/…​.bundle` wrapper) */
export function sceneLabel(file: string): string {
	return file.replace(/^scenes_scenes_scenes\//, '').replace(/\.bundle$/, '');
}

/** the scene-list rows the grouping operates on (the main page enriches these with count/named) */
export type SceneRowLike = { file: string; name: string };

export type SceneGroup<T extends SceneRowLike> = {
	/** group label (area prefix, or the single member's own name when ungrouped) */
	prefix: string;
	/** first (numerically smallest) file in the group — drives group ordering */
	file0: string;
	items: T[];
	/** render collapsibly (`true`) vs. as a single plain row (`false`) */
	group: boolean;
};

const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function build<T extends SceneRowLike>(
	rows: T[],
	keyOf: (s: T) => string,
	isGroup: (items: T[]) => boolean
): SceneGroup<T>[] {
	const by = new Map<string, T[]>();
	for (const s of rows) {
		const k = keyOf(s);
		(by.get(k) ?? by.set(k, []).get(k)!).push(s);
	}
	return [...by.entries()]
		.map(([prefix, items]): SceneGroup<T> => {
			items.sort((a, b) => coll.compare(a.file, b.file));
			return { prefix, items, file0: items[0].file, group: isGroup(items) };
		})
		.sort((a, b) => coll.compare(a.file0, b.file0));
}

/**
 * Group scene names by area = the token before the first `_`. A group is collapsible when it has
 * more than one member or any numbered member (`Ant_02` makes the whole `Ant` area a group, so
 * `Ant_Merchant` joins it); a lone non-numbered name (`Quit_To_Menu`, `Menu_Title`) stays flat.
 */
export function groupNamedScenes<T extends SceneRowLike>(rows: T[]): SceneGroup<T>[] {
	return build(
		rows,
		(s) => s.name.split('_')[0],
		(items) => items.length > 1 || items.some((s) => /_\d/.test(s.name))
	);
}

/**
 * Grouping key for non-scene asset files: the leading token before `_assets_` / the first `_`
 * (`localpoolprefabs_assets_areasong` -> `localpoolprefabs`), else the name with a trailing number
 * stripped (`sharedassets176` -> `sharedassets`, `resources.assets` -> `resources`).
 */
export function otherGroupKey(file: string): string {
	const s = sceneLabel(file).replace(/\.(assets|bundle)$/, '');
	const us = s.indexOf('_');
	return us > 0 ? s.slice(0, us) : s.replace(/\d+$/, '') || s;
}

/** Group asset files by {@link otherGroupKey}; collapsible only when a key actually repeats. */
export function groupOtherFiles<T extends SceneRowLike>(rows: T[]): SceneGroup<T>[] {
	return build(
		rows,
		(s) => otherGroupKey(s.file),
		(items) => items.length > 1
	);
}
