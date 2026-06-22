<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		GAMES,
		fetchIndex,
		fetchSceneNames,
		goLeaf,
		isGame,
		sceneLabel,
		type Game
	} from '$lib/data';

	// navigation + filter state live in the URL so reloads/back restore the exact view
	const params = $derived(page.url.searchParams);
	const game = $derived<Game>(isGame(params.get('game')) ? (params.get('game') as Game) : 'hk');
	const scene = $derived(params.get('scene')); // null = scenes view
	const query = $derived(params.get('q') ?? '');

	// numeric-aware ordering so `level2` sorts before `level10`
	const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const byName = <T extends { name: string }>(a: T, b: T) => coll.compare(a.name, b.name);

	function setQuery(v: string) {
		const p = new URLSearchParams(params);
		if (v) p.set('q', v);
		else p.delete('q');
		// replaceState: typing shouldn't spam the history stack
		goto(`${base}/?${p}`, { keepFocus: true, noScroll: true, replaceState: true });
	}

	function hrefFor(opts: { game?: Game; scene?: string }) {
		const p = new URLSearchParams();
		p.set('game', opts.game ?? game);
		if (opts.scene) p.set('scene', opts.scene);
		return `${base}/?${p}`;
	}
	const fsmHref = (hash: string) => `${base}/fsm/${game}/${hash}`;

	const indexQuery = createQuery(() => ({
		queryKey: ['index', game],
		queryFn: () => fetchIndex(game)
	}));
	const entries = $derived(indexQuery.data ?? []);

	const sceneNamesQuery = createQuery(() => ({
		queryKey: ['sceneNames', game],
		queryFn: () => fetchSceneNames(game)
	}));
	const sceneNames = $derived(sceneNamesQuery.data ?? new Map<string, string>());
	const sceneTitle = (file: string) => sceneNames.get(file) ?? sceneLabel(file);

	const match = (s: string) => s.toLowerCase().includes(query.trim().toLowerCase());

	// sort by file (numeric, so level2 < level10) but show the human scene name when known
	const byFile = (a: { file: string }, b: { file: string }) => coll.compare(a.file, b.file);

	type SceneRow = { file: string; name: string; count: number; named: boolean };
	const scenes = $derived.by(() => {
		const by = new Map<string, number>();
		for (const e of entries) by.set(e.file, (by.get(e.file) ?? 0) + 1);
		const rows: SceneRow[] = [...by.entries()].map(([file, count]) => {
			const named = sceneNames.has(file);
			return { file, count, named, name: named ? sceneNames.get(file)! : sceneLabel(file) };
		});
		return rows.filter((s) => match(s.name) || match(s.file)).sort(byFile);
	});
	// real game scenes first (have a scene name), then the leftover asset files
	const namedScenes = $derived(scenes.filter((s) => s.named));
	const otherScenes = $derived(scenes.filter((s) => !s.named));

	type FsmLeaf = { name: string; hash: string };
	type TreeNode = { name: string; children: Map<string, TreeNode>; fsms: FsmLeaf[] };

	const newNode = (name: string): TreeNode => ({ name, children: new Map(), fsms: [] });

	// build the GameObject hierarchy for the selected scene; FSMs hang off their owning object
	const tree = $derived.by(() => {
		const root = newNode('');
		if (scene === null) return root;
		for (const e of entries) {
			if (e.file !== scene) continue;
			if (query && !(match(e.name) || match(e.game_object))) continue;
			const segs = e.game_object === '' ? [] : e.game_object.split('/');
			let node = root;
			for (const seg of segs) {
				let child = node.children.get(seg);
				if (!child) node.children.set(seg, (child = newNode(seg)));
				node = child;
			}
			node.fsms.push({ name: e.name, hash: e.hash });
		}
		return root;
	});

	function countFsms(n: TreeNode): number {
		let c = n.fsms.length;
		for (const child of n.children.values()) c += countFsms(child);
		return c;
	}
	const sortedChildren = (n: TreeNode) => [...n.children.values()].sort(byName);
	const sortedFsms = (n: TreeNode) => [...n.fsms].sort(byName);
	const sceneCount = $derived(scene === null ? 0 : countFsms(tree));

	const placeholder = $derived(scene === null ? 'filter scenes…' : 'filter objects & FSMs…');
</script>

{#snippet fsmLeaves(node: TreeNode)}
	{#if node.fsms.length}
		<ul class="fsms">
			{#each sortedFsms(node) as f (f.hash + f.name)}
				<li><a href={fsmHref(f.hash)}>{f.name}</a></li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet treeNodes(node: TreeNode)}
	<ul class="tree">
		{#each sortedChildren(node) as child (child.name)}
			<li>
				{#if child.children.size}
					<details open>
						<summary>
							<span class="obj">{child.name}</span>
							<span class="dim badge">{countFsms(child)}</span>
						</summary>
						{@render fsmLeaves(child)}
						{@render treeNodes(child)}
					</details>
				{:else}
					<div class="objrow"><span class="obj">{child.name}</span></div>
					{@render fsmLeaves(child)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<header>
	<div class="topline">
		<h1>PlayMaker FSM browser</h1>
		<div class="games">
			{#each GAMES as g (g.id)}
				<a class="gamebtn" class:active={game === g.id} href={hrefFor({ game: g.id })}>{g.label}</a>
			{/each}
		</div>
	</div>

	<nav class="crumbs">
		<a class="crumb" class:active={scene === null} href={hrefFor({})}>scenes</a>
		{#if scene !== null}
			<span class="sep">›</span>
			<span class="crumb active" title={scene}>{sceneTitle(scene)}</span>
		{/if}
	</nav>

	<!-- svelte-ignore a11y_autofocus -->
	<input
		class="filter"
		{placeholder}
		value={query}
		oninput={(e) => setQuery(e.currentTarget.value)}
		autofocus
	/>
</header>

{#if indexQuery.isPending}
	<p class="msg dim">loading…</p>
{:else if indexQuery.isError}
	<p class="msg err">{String(indexQuery.error)}</p>
{:else if scene === null}
	<div class="count dim">{namedScenes.length} scenes</div>
	<ul class="grid">
		{#each namedScenes as s (s.file)}
			<li>
				<a class="rowlink" href={hrefFor({ scene: s.file })} title={s.file}>{s.name}</a>
				<span class="dim badge">{s.count}</span>
			</li>
		{/each}
	</ul>
	{#if otherScenes.length}
		<div class="count dim section">{otherScenes.length} other files</div>
		<ul class="grid">
			{#each otherScenes as s (s.file)}
				<li>
					<a class="rowlink" href={hrefFor({ scene: s.file })} title={s.file}>{s.name}</a>
					<span class="dim badge">{s.count}</span>
				</li>
			{/each}
		</ul>
	{/if}
{:else}
	<div class="count dim">{sceneCount} FSMs</div>
	<div class="treewrap">
		{#if tree.fsms.length}
			<div class="objrow"><span class="obj dim">{goLeaf('')}</span></div>
			{@render fsmLeaves(tree)}
		{/if}
		{@render treeNodes(tree)}
	</div>
{/if}

<style>
	header {
		padding: 0.85rem 1.25rem;
		position: sticky;
		top: 0;
		background: var(--bg);
		border-bottom: 1px solid #333;
		z-index: 1;
	}
	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h1 {
		font-size: 1.05rem;
		margin: 0;
	}
	.gamebtn {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		padding: 0.3rem 0.7rem;
		cursor: pointer;
		border-radius: 4px;
		text-decoration: none;
	}
	.gamebtn.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.crumbs {
		margin: 0.6rem 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: ui-monospace, Menlo, monospace;
		font-size: 0.9rem;
	}
	.crumb {
		color: var(--accent);
		text-decoration: none;
	}
	.crumb:hover {
		text-decoration: underline;
	}
	.crumb.active {
		color: var(--fg);
		cursor: default;
		text-decoration: none;
	}
	.sep {
		color: var(--dim);
	}
	.filter {
		width: 100%;
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		padding: 0.4rem 0.65rem;
		border-radius: 4px;
	}
	.count {
		padding: 0.6rem 1.25rem 0;
		font-size: 0.85rem;
	}
	.count.section {
		margin-top: 1rem;
		border-top: 1px solid #2a2a2a;
		padding-top: 0.8rem;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0.4rem 1.25rem 2rem;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 0.1rem 1.5rem;
	}
	.grid li {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.15rem 0;
		min-width: 0;
	}
	.rowlink {
		color: var(--accent);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rowlink:hover {
		text-decoration: underline;
	}
	.badge {
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	/* object tree */
	.treewrap {
		padding: 0.4rem 1.25rem 2rem;
	}
	.tree {
		list-style: none;
		margin: 0;
		padding-left: 1.1rem;
		border-left: 1px solid #2a2a2a;
	}
	.treewrap > .tree {
		padding-left: 0;
		border-left: none;
	}
	details > summary {
		cursor: pointer;
		padding: 0.1rem 0;
	}
	.obj {
		color: var(--fg);
	}
	.objrow {
		padding: 0.1rem 0;
	}
	.fsms {
		list-style: none;
		margin: 0;
		padding-left: 1.1rem;
	}
	.fsms li {
		padding: 0.05rem 0;
	}
	.fsms a {
		color: var(--accent);
		text-decoration: none;
	}
	.fsms a:hover {
		text-decoration: underline;
	}
	.msg {
		padding: 1rem 1.25rem;
	}
	.err {
		color: #e06c75;
	}
</style>
