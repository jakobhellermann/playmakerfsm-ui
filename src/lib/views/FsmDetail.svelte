<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchModel, isGame, type Game } from '$lib/data';
	import RawView from '$lib/views/RawView.svelte';
	import PseudoView from '$lib/views/PseudoView.svelte';
	import GraphView from '$lib/views/GraphView.svelte';

	let { game, hash }: { game: Game; hash: string } = $props();

	type Mode = 'raw' | 'pseudo' | 'graph';
	const MODES: { id: Mode; label: string }[] = [
		{ id: 'pseudo', label: 'pseudocode' },
		{ id: 'graph', label: 'graph' },
		{ id: 'raw', label: 'raw' }
	];
	const isMode = (s: string | null): s is Mode => s === 'raw' || s === 'pseudo' || s === 'graph';

	// view mode is a global preference (localStorage), overridable per-FSM via ?mode=
	const STORAGE_KEY = 'fsm:view-mode';
	let stored = $state<Mode>('graph');
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
		goto(`${page.url.pathname}?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	const modelQuery = createQuery(() => ({
		queryKey: ['model', game, hash],
		queryFn: () => fetchModel(game, hash),
		enabled: isGame(game) && hash !== ''
	}));
</script>

{#if modelQuery.isError}
	<p class="msg err">{String(modelQuery.error)}</p>
{:else if !modelQuery.data}
	<p class="msg dim">loading…</p>
{:else}
	{@const m = modelQuery.data}
	{#if mode === 'graph'}
		<!-- the graph hosts the mode tabs in its own toolbar (same row as +/−/fit) -->
		<GraphView model={m} {modeTabs} />
	{:else}
		<div class="bar">{@render modeTabs()}</div>
		{#if mode === 'pseudo'}
			<PseudoView model={m} />
		{:else}
			<RawView model={m} />
		{/if}
	{/if}
{/if}

{#snippet modeTabs()}
	<div class="modes">
		{#each MODES as mo (mo.id)}
			<button class:active={mode === mo.id} onclick={() => setMode(mo.id)}>{mo.label}</button>
		{/each}
	</div>
{/snippet}

<style>
	.bar {
		display: flex;
		justify-content: flex-end;
		padding: 0.5rem var(--pad-x);
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
	.msg {
		padding: 1rem var(--pad-x);
	}
	.err {
		color: #e06c75;
	}
</style>
