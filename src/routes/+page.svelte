<script lang="ts">
	import { base } from '$app/paths';
	import { GAMES, loadIndex, type Game } from '$lib/data';
	import type { IndexEntry } from '$lib/model';

	let game = $state<Game>('hk');
	let query = $state('');
	let entries = $state<IndexEntry[]>([]);
	let error = $state<string | null>(null);

	$effect(() => {
		const g = game;
		entries = [];
		error = null;
		loadIndex(g)
			.then((e) => {
				if (game === g) entries = e;
			})
			.catch((err) => {
				if (game === g) error = String(err);
			});
	});

	// one row per distinct content hash, with how many references point at it
	type Row = { hash: string; name: string; refs: number };
	const rows = $derived.by<Row[]>(() => {
		const by = new Map<string, Row>();
		for (const e of entries) {
			const r = by.get(e.hash);
			if (r) r.refs++;
			else by.set(e.hash, { hash: e.hash, name: e.name, refs: 1 });
		}
		return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	const LIMIT = 400;
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((r) => r.name.toLowerCase().includes(q));
	});
	const shown = $derived(filtered.slice(0, LIMIT));
</script>

<header>
	<h1>PlayMaker FSM browser</h1>
	<div class="controls">
		<div class="games">
			{#each GAMES as g (g.id)}
				<button class:active={game === g.id} onclick={() => (game = g.id)}>{g.label}</button>
			{/each}
		</div>
		<input placeholder="filter by name…" bind:value={query} />
	</div>
	<div class="dim status">
		{#if error}
			<span class="err">{error}</span>
		{:else}
			{filtered.length} of {rows.length} distinct FSMs{#if filtered.length > LIMIT}
				— showing first {LIMIT}{/if}
		{/if}
	</div>
</header>

<ul class="list">
	{#each shown as r (r.hash)}
		<li>
			<a href="{base}/fsm/{game}/{r.hash}">{r.name}</a>
			{#if r.refs > 1}<span class="dim">×{r.refs}</span>{/if}
		</li>
	{/each}
</ul>

<style>
	header {
		padding: 1rem 1.25rem;
		position: sticky;
		top: 0;
		background: var(--bg);
		border-bottom: 1px solid #333;
	}
	h1 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	.controls {
		display: flex;
		gap: 0.75rem;
		align-items: center;
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
	input {
		flex: 1;
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		padding: 0.35rem 0.6rem;
		border-radius: 4px;
	}
	.status {
		margin-top: 0.5rem;
	}
	.err {
		color: #e06c75;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0.5rem 1.25rem;
		columns: 3;
		column-gap: 2rem;
	}
	.list li {
		break-inside: avoid;
		padding: 0.15rem 0;
	}
</style>
