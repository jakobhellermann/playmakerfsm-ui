<script lang="ts">
	import { base } from '$app/paths';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchModel, isGame, type Game } from '$lib/data';
	import RawView from '$lib/views/RawView.svelte';
	import PseudoView from '$lib/views/PseudoView.svelte';
	import GraphView from '$lib/views/GraphView.svelte';

	const game = $derived((page.params.game ?? 'hk') as Game);
	const hash = $derived(page.params.hash ?? '');

	type Mode = 'raw' | 'pseudo' | 'graph';
	const MODES: { id: Mode; label: string }[] = [
		{ id: 'raw', label: 'raw' },
		{ id: 'pseudo', label: 'pseudocode' },
		{ id: 'graph', label: 'graph' }
	];
	const isMode = (s: string | null): s is Mode => s === 'raw' || s === 'pseudo' || s === 'graph';

	// view mode is a global preference (localStorage) so it carries across FSMs; an explicit
	// ?mode= in the URL overrides it (and becomes the new preference)
	const STORAGE_KEY = 'fsm:view-mode';
	let stored = $state<Mode>('raw');
	if (browser && isMode(localStorage.getItem(STORAGE_KEY)))
		stored = localStorage.getItem(STORAGE_KEY) as Mode;

	const urlMode = $derived(page.url.searchParams.get('mode'));
	const mode = $derived<Mode>(isMode(urlMode) ? urlMode : stored);

	$effect(() => {
		if (browser && isMode(urlMode) && urlMode !== stored) {
			stored = urlMode;
			localStorage.setItem(STORAGE_KEY, urlMode);
		}
	});

	function setMode(m: Mode) {
		stored = m;
		if (browser) localStorage.setItem(STORAGE_KEY, m);
		const p = new URLSearchParams(page.url.searchParams);
		p.set('mode', m);
		goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	const modelQuery = createQuery(() => ({
		queryKey: ['model', game, hash],
		queryFn: () => fetchModel(game, hash),
		enabled: isGame(game) && hash !== ''
	}));

	function back() {
		if (history.length > 1) history.back();
		else goto(`${base}/${game}`);
	}
</script>

<header>
	<nav>
		<a
			href="{base}/{game}"
			onclick={(e) => {
				e.preventDefault();
				back();
			}}>← back</a
		>
		<span class="dim mono">{hash}</span>
	</nav>

	{#if modelQuery.data}
		{@const m = modelQuery.data}
		<div class="title">
			<h1>{m.name}</h1>
			<div class="modes">
				{#each MODES as mo (mo.id)}
					<button class:active={mode === mo.id} onclick={() => setMode(mo.id)}>{mo.label}</button>
				{/each}
			</div>
		</div>
		<div class="dim stats">
			start=<span class="state">{m.start_state}</span> · {m.states.length} states · {m.events
				.length} events · {m.variables.length} vars
		</div>
	{/if}
</header>

{#if modelQuery.isError}
	<p class="msg err">{String(modelQuery.error)}</p>
{:else if !modelQuery.data}
	<p class="msg dim">loading…</p>
{:else if mode === 'pseudo'}
	<PseudoView model={modelQuery.data} />
{:else if mode === 'graph'}
	<GraphView model={modelQuery.data} />
{:else}
	<RawView model={modelQuery.data} />
{/if}

<style>
	header {
		padding: 1rem 1.25rem 0.75rem;
		border-bottom: 1px solid #333;
		position: sticky;
		top: 0;
		background: var(--bg);
		z-index: 1;
	}
	nav {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
	}
	.title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 0.4rem;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.modes button {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		padding: 0.25rem 0.6rem;
		cursor: pointer;
	}
	.modes button:first-child {
		border-radius: 4px 0 0 4px;
	}
	.modes button:last-child {
		border-radius: 0 4px 4px 0;
	}
	.modes button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.stats {
		margin-top: 0.3rem;
		font-size: 0.9rem;
	}
	.state {
		color: var(--state);
	}
	.msg {
		padding: 1rem 1.25rem;
	}
	.err {
		color: #e06c75;
	}
</style>
