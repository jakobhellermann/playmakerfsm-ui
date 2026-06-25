<script lang="ts">
	import type { FsmModel, State } from '$lib/model';
	import { actionTokens, type Token } from '$lib/pseudo';
	import { isDeadAction } from '$lib/actions';

	let { model }: { model: FsmModel } = $props();

	let root = $state<HTMLElement>();
	let flash = $state<string | null>(null);

	/** scroll to a state's `state X {` definition block (goto-definition) */
	function goto(name: string) {
		const el = root?.querySelector(`[data-state="${CSS.escape(name)}"]`);
		if (el instanceof HTMLElement) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			flash = name;
			setTimeout(() => {
				if (flash === name) flash = null;
			}, 1500);
		}
	}

	/** Ctrl+A inside the code block selects only the code, not the whole page */
	function onSelectAll(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || e.key !== 'a') return;
		e.preventDefault();
		const sel = getSelection();
		if (!sel || !root) return;
		const range = document.createRange();
		range.selectNodeContents(root);
		sel.removeAllRanges();
		sel.addRange(range);
	}

	/** resolve an event name to its target state (state transitions first, then global) */
	function eventTarget(state: State, event: string): string | undefined {
		return (
			state.transitions.find((t) => t.event === event)?.to_state ??
			model.global_transitions.find((t) => t.event === event)?.to_state
		);
	}
</script>

{#snippet stateRef(name: string)}
	{#if name}
		<span
			class="state link"
			role="button"
			tabindex="0"
			onclick={() => goto(name)}
			onkeydown={(e) => e.key === 'Enter' && goto(name)}>{name}</span
		>
	{:else}
		<span class="cmt">(none)</span>
	{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="code"
	bind:this={root}
	tabindex="0"
	role="region"
	aria-label="pseudocode"
	onkeydown={onSelectAll}
>
	<div><span class="kw">fsm</span> <span class="name">{model.name}</span> {'{'}</div>
	<div class="i1"><span class="kw">start</span> {@render stateRef(model.start_state)}</div>
	{#each model.global_transitions as t (t.event + t.to_state)}
		<div class="i1">
			<span class="kw">on</span> <span class="event">{t.event}</span>
			<span class="arrow">→</span>
			{@render stateRef(t.to_state)} <span class="cmt">// from any state</span>
		</div>
	{/each}

	{#each model.states as s (s.name)}
		<div class="blank"></div>
		<div class="i1" data-state={s.name} class:flash={flash === s.name}>
			<span class="kw">state</span> <span class="state">{s.name}</span>
			{'{'}
		</div>
		{#each s.actions as a, i (i)}
			{@const dead = a.enabled && isDeadAction(a)}
			<div class="i2" class:off={!a.enabled || dead}>
				{#each actionTokens(a) as t, k (k)}{#if t.event}{@const target = eventTarget(
							s,
							t.event
						)}{#if target}<span
								class="event link"
								role="button"
								tabindex="0"
								onclick={() => goto(target)}
								onkeydown={(e) => e.key === 'Enter' && goto(target)}>{t.text}</span
							>{:else}<span class={t.cls} title={t.title}>{t.text}</span>{/if}{:else}<span
							class={t.cls}
							title={t.title}>{t.text}</span
						>{/if}{/each}{#if !a.enabled}<span class="cmt">{' // disabled'}</span>{/if}
			</div>
		{/each}
		{#each s.transitions as t (t.event + t.to_state)}
			<div class="i2">
				<span class="kw">on</span> <span class="event">{t.event}</span>
				<span class="arrow">→</span>
				{@render stateRef(t.to_state)}
			</div>
		{/each}
		<div class="i1">{'}'}</div>
	{/each}
	<div>{'}'}</div>
</div>

<style>
	.code {
		padding: 1rem var(--pad-x) 3rem;
		font-family: ui-monospace, Menlo, monospace;
		font-size: 14px;
		line-height: 1.65;
	}
	.code > div {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.i1 {
		padding-left: 2ch;
	}
	.i2 {
		padding-left: 4ch;
		text-indent: -2ch;
		margin-left: 2ch;
	}
	.blank {
		height: 0.6rem;
	}
	.kw {
		color: #c678dd;
	}
	.name {
		color: var(--fg);
		font-weight: 600;
	}
	.act {
		color: var(--action);
	}
	.var {
		/* toned-down purple so variables sit behind the eye-catching state names */
		color: #9d8fb5;
	}
	.str {
		color: #cd9178;
	}
	.event {
		color: var(--event);
	}
	.state {
		color: var(--state);
		font-weight: 600;
	}
	.link {
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.arrow,
	.cmt {
		color: var(--dim);
	}
	.off {
		opacity: 0.55;
	}
	@keyframes flash {
		0% {
			background: color-mix(in srgb, var(--state) 30%, transparent);
		}
		100% {
			background: transparent;
		}
	}
	.flash {
		animation: flash 1.5s ease-out;
		border-radius: 2px;
	}
</style>
