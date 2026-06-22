<script lang="ts">
	import dagre from '@dagrejs/dagre';
	import type { FsmModel } from '$lib/model';
	import { actionTokens } from '$lib/pseudo';
	import { isDeadAction } from '$lib/actions';

	let { model }: { model: FsmModel } = $props();

	// state selected in the graph -> its pseudocode shows in the sidebar
	let selected = $state<string | null>(null);
	const selectedState = $derived(
		selected ? (model.states.find((s) => s.name === selected) ?? null) : null
	);

	const ANY = '★ any state';

	type Node = {
		id: string;
		label: string;
		x: number;
		y: number;
		w: number;
		h: number;
		start: boolean;
		any: boolean;
	};
	type Edge = {
		points: { x: number; y: number }[];
		label: string;
		global: boolean;
		lx: number;
		ly: number;
	};

	const layout = $derived.by(() => {
		const g = new dagre.graphlib.Graph({ multigraph: true });
		g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 46, marginx: 16, marginy: 16 });
		g.setDefaultEdgeLabel(() => ({}));

		const width = (s: string) => Math.max(54, s.length * 7.3 + 22);
		for (const s of model.states)
			g.setNode(s.name, { label: s.name, width: width(s.name), height: 30 });
		if (model.global_transitions.length)
			g.setNode(ANY, { label: ANY, width: width(ANY), height: 30 });

		const addEdge = (from: string, t: { event: string; to_state: string }, global: boolean) => {
			if (!g.hasNode(from) || !g.hasNode(t.to_state)) return;
			g.setEdge(from, t.to_state, { label: t.event, global }, `${from}|${t.event}|${t.to_state}`);
		};
		for (const s of model.states) for (const t of s.transitions) addEdge(s.name, t, false);
		for (const t of model.global_transitions) addEdge(ANY, t, true);

		dagre.layout(g);

		const nodes: Node[] = g.nodes().map((id) => {
			const n = g.node(id);
			return {
				id,
				label: n.label as string,
				x: n.x - n.width / 2,
				y: n.y - n.height / 2,
				w: n.width,
				h: n.height,
				start: id === model.start_state,
				any: id === ANY
			};
		});
		const edges: Edge[] = g.edges().map((e) => {
			const d = g.edge(e) as { points: { x: number; y: number }[]; label: string; global: boolean };
			const mid = d.points[Math.floor(d.points.length / 2)] ?? { x: 0, y: 0 };
			return { points: d.points, label: d.label, global: d.global, lx: mid.x, ly: mid.y };
		});
		const gl = g.graph();
		return { nodes, edges, width: gl.width ?? 100, height: gl.height ?? 100 };
	});

	const line = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

	// pan/zoom: an SVG <g> transform driven by mouse drag (pan) and wheel (zoom-to-cursor).
	// `view` null = follow the fit-to-canvas transform; any interaction pins it to concrete values.
	let canvas = $state<HTMLDivElement>();
	let cw = $state(0);
	let ch = $state(0);
	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

	const fit = $derived.by(() => {
		if (!cw || !ch || !layout.width || !layout.height) return { tx: 0, ty: 0, k: 1 };
		const k = Math.min((cw - 40) / layout.width, (ch - 40) / layout.height, 1);
		return { tx: (cw - layout.width * k) / 2, ty: (ch - layout.height * k) / 2, k };
	});
	let view = $state<{ tx: number; ty: number; k: number } | null>(null);
	const cur = $derived(view ?? fit);

	// re-fit and drop the selection whenever the layout (i.e. the model) changes
	$effect(() => {
		void layout;
		view = null;
		selected = null;
	});

	function zoomAround(mx: number, my: number, factor: number) {
		const k = clamp(cur.k * factor, 0.1, 4);
		const r = k / cur.k;
		view = { tx: mx - (mx - cur.tx) * r, ty: my - (my - cur.ty) * r, k };
	}
	function wheel(e: WheelEvent) {
		e.preventDefault();
		const rect = canvas?.getBoundingClientRect();
		if (!rect) return;
		zoomAround(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
	}

	let drag = $state<{ x: number; y: number; tx: number; ty: number } | null>(null);
	function down(e: MouseEvent) {
		drag = { x: e.clientX, y: e.clientY, tx: cur.tx, ty: cur.ty };
	}
	function move(e: MouseEvent) {
		if (!drag) return;
		view = { tx: drag.tx + (e.clientX - drag.x), ty: drag.ty + (e.clientY - drag.y), k: cur.k };
	}
	const end = () => (drag = null);
</script>

<svelte:window onmousemove={move} onmouseup={end} />

<div class="toolbar">
	<button onclick={() => zoomAround(cw / 2, ch / 2, 1.25)}>+</button>
	<button onclick={() => zoomAround(cw / 2, ch / 2, 0.8)}>−</button>
	<button onclick={() => (view = null)}>fit</button>
	<span class="dim"
		>{model.states.length} states · {Math.round(cur.k * 100)}% · drag to pan, scroll to zoom</span
	>
</div>

<div class="body">
	<!-- drag/wheel are mouse-only enhancements -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="canvas"
		bind:this={canvas}
		bind:clientWidth={cw}
		bind:clientHeight={ch}
		onmousedown={down}
		onwheel={wheel}
		class:grabbing={!!drag}
	>
		<svg class="stage">
			<defs>
				<marker
					id="arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill="#888" />
				</marker>
				<marker
					id="arrowg"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill="var(--var)" />
				</marker>
			</defs>

			<g transform="translate({cur.tx} {cur.ty}) scale({cur.k})">
				{#each layout.edges as e, i (i)}
					<polyline
						points={line(e.points)}
						fill="none"
						stroke={e.global ? 'var(--var)' : '#888'}
						stroke-width="1.3"
						marker-end="url(#{e.global ? 'arrowg' : 'arrow'})"
						opacity="0.8"
					/>
					<text x={e.lx} y={e.ly - 3} class="elabel" text-anchor="middle">{e.label}</text>
				{/each}

				{#each layout.nodes as n (n.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<g
						class:clickable={!n.any}
						onmousedown={(e) => {
							if (!n.any) e.stopPropagation();
						}}
						onclick={() => {
							if (!n.any) selected = n.id;
						}}
					>
						<rect
							x={n.x}
							y={n.y}
							width={n.w}
							height={n.h}
							rx="5"
							class="node"
							class:start={n.start}
							class:any={n.any}
							class:sel={selected === n.id}
						/>
						<text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} text-anchor="middle" class="nlabel"
							>{n.label}</text
						>
					</g>
				{/each}
			</g>
		</svg>
	</div>

	{#if selectedState}
		<aside class="sidebar">
			<div class="sbhead">
				<span class="state">{selectedState.name}</span>
				<button class="close" onclick={() => (selected = null)} aria-label="close">×</button>
			</div>
			<div class="code">
				{#each selectedState.actions as a, i (i)}
					{@const dead = a.enabled && isDeadAction(a)}
					<div class="line" class:off={!a.enabled || dead}>
						{#each actionTokens(a) as t, k (k)}<span class={t.cls}>{t.text}</span
							>{/each}{#if !a.enabled}<span class="cmt"> // disabled</span>{/if}
					</div>
				{/each}
				{#if selectedState.actions.length && selectedState.transitions.length}
					<div class="blank"></div>
				{/if}
				{#each selectedState.transitions as t (t.event + t.to_state)}
					<div class="line">
						<span class="kw">on</span> <span class="event">{t.event}</span>
						<span class="arrow">→</span>
						<button class="state link" onclick={() => (selected = t.to_state)}>{t.to_state}</button>
					</div>
				{/each}
				{#if !selectedState.actions.length && !selectedState.transitions.length}
					<div class="cmt">(no actions or transitions)</div>
				{/if}
			</div>
		</aside>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1.25rem;
	}
	.toolbar button {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		border-radius: 4px;
		width: 28px;
		height: 26px;
		cursor: pointer;
	}
	.toolbar button:last-of-type {
		width: auto;
		padding: 0 0.5rem;
	}
	.toolbar .dim {
		margin-left: 0.5rem;
		font-size: 0.85rem;
	}
	.body {
		display: flex;
		height: calc(100vh - 150px);
	}
	.canvas {
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}
	.canvas.grabbing {
		cursor: grabbing;
	}
	.clickable {
		cursor: pointer;
	}
	.node.sel {
		stroke: var(--accent);
		stroke-width: 2.5;
	}
	.sidebar {
		width: 360px;
		flex-shrink: 0;
		height: 100%;
		overflow: auto;
		border-left: 1px solid #333;
		background: var(--bg);
	}
	.sbhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid #333;
		position: sticky;
		top: 0;
		background: var(--bg);
	}
	.sbhead .state {
		font-weight: 600;
	}
	.close {
		background: none;
		border: none;
		color: var(--dim);
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0 0.2rem;
	}
	.close:hover {
		color: var(--fg);
	}
	.code {
		padding: 0.8rem 1rem 2rem;
		font-family: ui-monospace, Menlo, monospace;
		font-size: 13px;
		line-height: 1.6;
	}
	.code .line {
		white-space: pre-wrap;
		word-break: break-word;
		text-indent: -2ch;
		margin-left: 2ch;
	}
	.blank {
		height: 0.6rem;
	}
	.link {
		background: none;
		border: none;
		font: inherit;
		padding: 0;
		cursor: pointer;
	}
	.link:hover {
		text-decoration: underline;
	}
	.kw {
		color: #c678dd;
	}
	.act {
		color: var(--action);
	}
	.var {
		color: #9d8fb5;
	}
	.code .state {
		color: var(--state);
		font-weight: 600;
	}
	.code .event {
		color: var(--event);
	}
	.code .arrow {
		color: var(--dim);
	}
	.cmt {
		color: var(--dim);
	}
	.off {
		opacity: 0.55;
	}
	.stage {
		display: block;
		width: 100%;
		height: 100%;
	}
	.node {
		fill: var(--panel);
		stroke: #555;
		stroke-width: 1;
	}
	.node.start {
		stroke: var(--state);
		stroke-width: 2;
	}
	.node.any {
		fill: #2a2333;
		stroke: var(--var);
	}
	.nlabel {
		fill: var(--state);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 12px;
	}
	.elabel {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 10px;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3px;
	}
</style>
