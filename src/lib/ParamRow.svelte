<script lang="ts">
	import type { Param } from './model';
	import { fmtValue, valueKind } from './fmt';
	import Self from './ParamRow.svelte';

	let { param, depth = 0 }: { param: Param; depth?: number } = $props();
	const isList = $derived(param.value.type === 'List');
</script>

<div class="row" style="padding-left: {depth * 1.25}rem">
	<span class="name">{param.name || '·'}</span>
	<span class="dim">: {param.type_name} =</span>
	<span class="val {valueKind(param.value)}">{fmtValue(param.value)}</span>
</div>
{#if isList && param.value.type === 'List'}
	{#each param.value.value as child, i (i)}
		<Self param={child} depth={depth + 1} />
	{/each}
{/if}

<style>
	.row {
		font-family: ui-monospace, Menlo, monospace;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	.name {
		color: var(--fg);
	}
	.val.var {
		color: var(--var);
	}
	.val.event {
		color: var(--event);
	}
</style>
