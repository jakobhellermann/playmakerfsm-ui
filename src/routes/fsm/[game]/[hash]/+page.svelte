<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { fetchModel, isGame, type Game } from '$lib/data';
	import { short } from '$lib/fmt';
	import ParamRow from '$lib/ParamRow.svelte';

	const game = $derived((page.params.game ?? 'hk') as Game);
	const hash = $derived(page.params.hash ?? '');

	const modelQuery = createQuery(() => ({
		queryKey: ['model', game, hash],
		queryFn: () => fetchModel(game, hash),
		enabled: isGame(game) && hash !== ''
	}));

	function back() {
		if (history.length > 1) history.back();
		else goto(`${base}/`);
	}
</script>

<nav>
	<a
		href="{base}/"
		onclick={(e) => {
			e.preventDefault();
			back();
		}}>← back</a
	>
	<span class="dim mono">{hash}</span>
</nav>

{#if modelQuery.isError}
	<p class="err">{String(modelQuery.error)}</p>
{:else if !modelQuery.data}
	<p class="dim">loading…</p>
{:else}
	{@const m = modelQuery.data}
	<h1>{m.name}</h1>
	<div class="dim">
		start=<span class="state">{m.start_state}</span> · {m.states.length} states · {m.events.length}
		events
	</div>

	{#if m.events.length}
		<section>
			<h2>Events</h2>
			{#each m.events as e (e.name)}
				<div class="mono">
					<span class="event">{e.name}</span>
					{#if e.is_global}<span class="dim">(global)</span>{/if}
					{#if e.is_system}<span class="dim">(system)</span>{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if m.global_transitions.length}
		<section>
			<h2>Global transitions</h2>
			{#each m.global_transitions as t (t.event + t.to_state)}
				<div class="mono">
					on <span class="event">{t.event}</span> → <span class="state">{t.to_state}</span>
				</div>
			{/each}
		</section>
	{/if}

	<section>
		<h2>States</h2>
		{#each m.states as s (s.name)}
			<div class="state-block">
				<div class="state-head">
					{#if s.is_start}<span class="dim">*</span>{/if}
					<span class="state">{s.name}</span>
				</div>
				{#each s.transitions as t (t.event + t.to_state)}
					<div class="mono trans">
						on <span class="event">{t.event}</span> → <span class="state">{t.to_state}</span>
					</div>
				{/each}
				{#each s.actions as a, i (i)}
					<div class="action">
						<div class="action-head">
							<span class="act">{short(a.class)}</span>
							{#if a.custom_name && a.custom_name !== short(a.class)}<span class="dim"
									>"{a.custom_name}"</span
								>{/if}
							{#if !a.enabled}<span class="dim">(disabled)</span>{/if}
						</div>
						{#each a.params as p, j (j)}
							<ParamRow param={p} />
						{/each}
					</div>
				{/each}
			</div>
		{/each}
	</section>

	{#if m.variables.length}
		<section>
			<h2>Variables</h2>
			{#each m.variables as v (v.category + v.name)}
				<div class="mono">
					<span class="dim">({v.category})</span> <span class="var">{v.name}</span>
				</div>
			{/each}
		</section>
	{/if}
{/if}

<style>
	nav,
	h1,
	section,
	.dim {
		padding-left: 1.25rem;
		padding-right: 1.25rem;
	}
	nav {
		padding-top: 1rem;
	}
	h1 {
		margin: 0.5rem 0 0;
	}
	h2 {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--dim);
		margin: 1.5rem 0 0.5rem;
	}
	section {
		padding-left: 1.25rem;
	}
	.state-block {
		margin: 0.75rem 0;
	}
	.state-head {
		font-weight: 600;
	}
	.trans {
		padding-left: 1.5rem;
	}
	.action {
		margin: 0.4rem 0 0.4rem 1rem;
		border-left: 2px solid #333;
		padding-left: 0.75rem;
	}
	.action-head {
		font-family: ui-monospace, Menlo, monospace;
	}
	.event {
		color: var(--event);
	}
	.state {
		color: var(--state);
	}
	.act {
		color: var(--action);
	}
	.var {
		color: var(--var);
	}
	.err {
		color: #e06c75;
		padding-left: 1.25rem;
	}
</style>
