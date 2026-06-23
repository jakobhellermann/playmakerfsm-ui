<script lang="ts">
	import { base } from '$app/paths';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { GAMES, DEFAULT_GAME, fetchSceneNames, isGame, sceneLabel, type Game } from '$lib/data';

	let { children } = $props();

	const game = $derived<Game>(
		isGame(page.params.game ?? null) ? (page.params.game as Game) : DEFAULT_GAME
	);
	const gameLabel = $derived(GAMES.find((g) => g.id === game)?.label ?? game);
	const scene = $derived(page.params.scene ?? null);
	// segments below the scene: [] = object tree, [...gameObject, fsm] = an FSM detail
	const rest = $derived(page.params.rest ? page.params.rest.split('/') : []);
	const isDetail = $derived(scene !== null && rest.length > 0);
	const query = $derived(page.url.searchParams.get('q') ?? '');

	const sceneNamesQuery = createQuery(() => ({
		queryKey: ['sceneNames', game],
		queryFn: () => fetchSceneNames(game)
	}));
	const sceneTitle = (file: string) => sceneNamesQuery.data?.get(file) ?? sceneLabel(file);

	const sceneHref = $derived(scene ? `${base}/${game}/${encodeURIComponent(scene)}` : '');
	// the FSM name shown in the breadcrumb (drop the disambiguating ":n" suffix)
	const fsmCrumb = $derived(isDetail ? rest[rest.length - 1].replace(/:\d+$/, '') : '');

	const placeholder = $derived(
		scene === null ? 'filter scenes & files…' : 'filter objects & FSMs…'
	);

	function setQuery(v: string) {
		const p = new URLSearchParams(page.url.searchParams);
		if (v) p.set('q', v);
		else p.delete('q');
		const qs = p.toString();
		goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}

	// focus the filter on arrival; afterNavigate runs after SvelteKit's own focus handling
	let filterEl = $state<HTMLInputElement>();
	afterNavigate(() => {
		if (filterEl && document.activeElement !== filterEl) filterEl.focus();
	});
</script>

<svelte:head>
	<title>
		{isDetail
			? `${fsmCrumb} — ${sceneTitle(scene ?? '')}`
			: scene
				? `${sceneTitle(scene)}`
				: `FSMs — ${gameLabel}`}
	</title>
</svelte:head>

<header>
	<div class="topline">
		<a class="home" href="{base}/{game}"><h1>PlayMaker FSM browser</h1></a>
		<div class="games">
			{#each GAMES as g (g.id)}
				<a class="gamebtn" class:active={game === g.id} href="{base}/{g.id}">{g.label}</a>
			{/each}
		</div>
	</div>

	<nav class="crumbs">
		<a class="crumb" class:active={scene === null} href="{base}/{game}">{gameLabel}</a>
		{#if scene !== null}
			<span class="sep">›</span>
			{#if isDetail}
				<a class="crumb" href={sceneHref} title={scene}>{sceneTitle(scene)}</a>
				<span class="sep">›</span>
				<span class="crumb active">{fsmCrumb}</span>
			{:else}
				<span class="crumb active" title={scene}>{sceneTitle(scene)}</span>
			{/if}
		{/if}
	</nav>

	{#if !isDetail}
		<input
			class="filter"
			{placeholder}
			value={query}
			oninput={(e) => setQuery(e.currentTarget.value)}
			bind:this={filterEl}
		/>
	{/if}
</header>

{@render children()}

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
	.home {
		color: inherit;
		text-decoration: none;
	}
	h1 {
		font-size: 1.1rem;
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
		font-size: 0.95rem;
		flex-wrap: wrap;
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
</style>
