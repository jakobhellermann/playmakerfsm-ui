<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { GAMES, fetchIndex, goLeaf, isGame, sceneLabel, type Game } from '$lib/data';

	// navigation state lives in the URL so reloads restore the exact view
	const params = $derived(page.url.searchParams);
	const game = $derived<Game>(isGame(params.get('game')) ? (params.get('game') as Game) : 'hk');
	const scene = $derived(params.get('scene')); // null = scenes view
	const go = $derived(params.has('go') ? params.get('go')! : null); // null = game-objects view

	let query = $state('');

	function nav(next: { game?: Game; scene?: string | null; go?: string | null }) {
		const p = new URLSearchParams(params);
		if (next.game !== undefined) p.set('game', next.game);
		if ('scene' in next) {
			if (next.scene) p.set('scene', next.scene);
			else p.delete('scene');
			p.delete('go');
		}
		if ('go' in next) {
			if (next.go !== null && next.go !== undefined) p.set('go', next.go);
			else p.delete('go');
		}
		query = ''; // each drill-down level starts unfiltered
		goto(`?${p}`, { keepFocus: true, noScroll: true });
	}

	const indexQuery = createQuery(() => ({
		queryKey: ['index', game],
		queryFn: () => fetchIndex(game)
	}));
	const entries = $derived(indexQuery.data ?? []);

	const match = (s: string) => s.toLowerCase().includes(query.trim().toLowerCase());

	const scenes = $derived.by(() => {
		const by = new Map<string, number>();
		for (const e of entries) by.set(e.file, (by.get(e.file) ?? 0) + 1);
		return [...by.entries()]
			.map(([file, count]) => ({ file, label: sceneLabel(file), count }))
			.filter((s) => match(s.label))
			.sort((a, b) => a.label.localeCompare(b.label));
	});

	// area = the scene-name prefix before the first underscore; only shown as quick-filter chips when
	// it actually groups (true for Silksong's `abyss_05`, `bellway_…`; not for HK's `levelN`)
	const areas = $derived.by(() => {
		if (scene !== null) return [];
		const files = new Set(entries.map((e) => e.file));
		const by = new Map<string, number>();
		for (const f of files) {
			const a = sceneLabel(f).split('_')[0];
			by.set(a, (by.get(a) ?? 0) + 1);
		}
		if (by.size < 2 || by.size > files.size * 0.7) return [];
		return [...by.entries()]
			.map(([area, count]) => ({ area, count }))
			.sort((a, b) => a.area.localeCompare(b.area));
	});

	const gameObjects = $derived.by(() => {
		if (scene === null) return [];
		const by = new Map<string, number>();
		for (const e of entries)
			if (e.file === scene) by.set(e.game_object, (by.get(e.game_object) ?? 0) + 1);
		return [...by.entries()]
			.map(([path, count]) => ({ path, label: goLeaf(path), count }))
			.filter((g) => match(g.label) || match(g.path))
			.sort((a, b) => a.label.localeCompare(b.label));
	});

	const fsms = $derived.by(() => {
		if (scene === null || go === null) return [];
		return entries
			.filter((e) => e.file === scene && e.game_object === go)
			.filter((e) => match(e.name))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	const placeholder = $derived(
		scene === null ? 'filter scenes…' : go === null ? 'filter game objects…' : 'filter FSMs…'
	);
</script>

<header>
	<div class="topline">
		<h1>PlayMaker FSM browser</h1>
		<div class="games">
			{#each GAMES as g (g.id)}
				<button class:active={game === g.id} onclick={() => nav({ game: g.id, scene: null })}>
					{g.label}
				</button>
			{/each}
		</div>
	</div>

	<nav class="crumbs">
		<button class="crumb" class:active={scene === null} onclick={() => nav({ scene: null })}>
			scenes
		</button>
		{#if scene !== null}
			<span class="sep">›</span>
			<button class="crumb" class:active={go === null} onclick={() => nav({ scene, go: null })}>
				{sceneLabel(scene)}
			</button>
		{/if}
		{#if scene !== null && go !== null}
			<span class="sep">›</span>
			<span class="crumb active" title={go}>{goLeaf(go)}</span>
		{/if}
	</nav>

	<!-- svelte-ignore a11y_autofocus -->
	<input class="filter" {placeholder} bind:value={query} autofocus />
</header>

{#if indexQuery.isPending}
	<p class="msg dim">loading…</p>
{:else if indexQuery.isError}
	<p class="msg err">{String(indexQuery.error)}</p>
{:else if scene === null}
	{#if areas.length}
		<div class="chips">
			{#each areas as a (a.area)}
				<button
					class="chip"
					class:active={query === a.area}
					onclick={() => (query = query === a.area ? '' : a.area)}
				>
					{a.area} <span class="dim">{a.count}</span>
				</button>
			{/each}
		</div>
	{/if}
	<div class="count dim">{scenes.length} scenes</div>
	<ul class="grid">
		{#each scenes as s (s.file)}
			<li>
				<button class="rowbtn" onclick={() => nav({ scene: s.file })}>{s.label}</button>
				<span class="dim badge">{s.count}</span>
			</li>
		{/each}
	</ul>
{:else if go === null}
	<div class="count dim">{gameObjects.length} game objects</div>
	<ul class="grid">
		{#each gameObjects as g (g.path)}
			<li>
				<button class="rowbtn" onclick={() => nav({ go: g.path })} title={g.path}>{g.label}</button>
				<span class="dim badge">{g.count}</span>
			</li>
		{/each}
	</ul>
{:else}
	<div class="count dim">{fsms.length} FSMs</div>
	<ul class="grid">
		{#each fsms as e (e.path_id)}
			<li><a href="{base}/fsm/{game}/{e.hash}">{e.name}</a></li>
		{/each}
	</ul>
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
	.games button {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		padding: 0.3rem 0.7rem;
		cursor: pointer;
		border-radius: 4px;
	}
	.games button.active {
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
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
		font: inherit;
	}
	.crumb.active {
		color: var(--fg);
		cursor: default;
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
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		padding: 0.7rem 1.25rem 0;
	}
	.chip {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		cursor: pointer;
		font-size: 0.82rem;
	}
	.chip.active {
		border-color: var(--accent);
		color: var(--accent);
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
	.rowbtn {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
		font: inherit;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rowbtn:hover {
		text-decoration: underline;
	}
	.badge {
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	.msg {
		padding: 1rem 1.25rem;
	}
	.err {
		color: #e06c75;
	}
</style>
