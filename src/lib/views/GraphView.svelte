<script module lang="ts">
	import { browser } from '$app/environment';

	// bottom pseudocode panel height is drag-resizable and persisted in localStorage
	const SIDEBAR_KEY = 'fsm:graph-panel-h';
	const CFG_KEY = 'fsm:graph-layout-cfg';
	let panelHeight = $state((browser && Number(localStorage.getItem(SIDEBAR_KEY))) || 320);
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import dagre from '@dagrejs/dagre';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { FsmModel } from '$lib/model';
	import { actionTokens } from '$lib/pseudo';
	import { isDeadAction } from '$lib/actions';

	// `modeTabs` lets the detail view drop its mode switcher into the toolbar (same row as +/−/fit)
	let { model, modeTabs }: { model: FsmModel; modeTabs?: Snippet } = $props();

	type RankDir = 'TB' | 'BT' | 'LR' | 'RL';
	type Ranker = 'network-simplex' | 'tight-tree' | 'longest-path';
	const defaultCfg: { rankdir: RankDir; ranker: Ranker; nodesep: number; ranksep: number } = {
		rankdir: 'TB',
		ranker: 'network-simplex',
		nodesep: 28,
		ranksep: 46
	};
	let layoutCfg = $state<{ rankdir: RankDir; ranker: Ranker; nodesep: number; ranksep: number }>(
		browser && localStorage.getItem(CFG_KEY)
			? { ...defaultCfg, ...JSON.parse(localStorage.getItem(CFG_KEY)!) }
			: { ...defaultCfg }
	);
	let showCfg = $state(false);
	$effect(() => {
		if (browser) localStorage.setItem(CFG_KEY, JSON.stringify(layoutCfg));
	});

	// the selected state lives in the URL (?state=) so it survives reload and is shareable; its
	// pseudocode shows in the sidebar
	const selected = $derived(page.url.searchParams.get('state'));
	const selectedState = $derived(
		selected ? (model.states.find((s) => s.name === selected) ?? null) : null
	);
	function select(name: string | null) {
		const p = new URLSearchParams(page.url.searchParams);
		if (name) p.set('state', name);
		else p.delete('state');
		goto(`?${p}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	const ANY = '★ any state';

	const CHAR = 7.3;
	const ROW_H = 20;
	const PAD_Y = 0;

	// a state inside a chain node: its name + the event that transitions to the next state (empty on last)
	type ChainState = { name: string; event: string };

	type Node = {
		id: string;
		label: string;
		x: number;
		y: number;
		w: number;
		h: number;
		start: boolean;
		any: boolean;
		/** present when this node is a collapsed linear chain */
		chain?: ChainState[];
	};
	type Edge = {
		points: { x: number; y: number }[];
		label: string;
		global: boolean;
		from: string;
		to: string;
		lx: number;
		ly: number;
	};

	const layout = $derived.by(() => {
		// ── chain detection ──
		const outs = new Map<string, { event: string; to: string }[]>();
		const ins = new Map<string, { event: string; from: string }[]>();
		for (const s of model.states)
			for (const t of s.transitions) {
				(outs.get(s.name) ?? outs.set(s.name, []).get(s.name)!).push({
					event: t.event,
					to: t.to_state
				});
				(ins.get(t.to_state) ?? ins.set(t.to_state, []).get(t.to_state)!).push({
					event: t.event,
					from: s.name
				});
			}
		const isChainLink = (from: string, to: string): boolean => {
			if (!to || from === to || from === ANY || to === ANY) return false;
			const o = outs.get(from) ?? [];
			const i = ins.get(to) ?? [];
			return o.length === 1 && o[0].to === to && i.length === 1 && i[0].from === from;
		};
		const visited = new Set<string>();
		const groups: { states: string[]; events: string[] }[] = [];
		const startChain = (start: string) => {
			if (visited.has(start)) return;
			const states: string[] = [start];
			const events: string[] = [];
			visited.add(start);
			let cur = start;
			while (true) {
				const o = outs.get(cur) ?? [];
				if (o.length !== 1 || !isChainLink(cur, o[0].to)) break;
				const next = o[0].to;
				if (visited.has(next)) break;
				events.push(o[0].event);
				states.push(next);
				visited.add(next);
				cur = next;
			}
			groups.push({ states, events });
		};
		for (const s of model.states) {
			const i = ins.get(s.name) ?? [];
			if (i.length === 1 && isChainLink(i[0].from, s.name)) continue;
			startChain(s.name);
		}
		for (const s of model.states) startChain(s.name);
		// no ANY node — global transitions render as incoming arrows above their target
		const groupOf = new Map<string, number>();
		groups.forEach((grp, i) => grp.states.forEach((s) => groupOf.set(s, i)));

		// ── dagre layout on groups (compact) + multigraph edge routing ──
		const g = new dagre.graphlib.Graph({ multigraph: true });
		g.setGraph({
			rankdir: layoutCfg.rankdir,
			ranker: layoutCfg.ranker,
			nodesep: layoutCfg.nodesep,
			ranksep: layoutCfg.ranksep,
			marginx: 16,
			marginy: 16
		});
		g.setDefaultEdgeLabel(() => ({}));
		const width = (s: string) => Math.max(54, s.length * CHAR + 22);
		groups.forEach((grp, i) => {
			const w = Math.max(54, ...grp.states.map((s) => s.length * CHAR + 22));
			const h = grp.states.length === 1 ? 30 : grp.states.length * ROW_H + PAD_Y * 2;
			g.setNode(String(i), { width: w, height: h });
		});
		const addEdge = (from: string, event: string, to: string, global: boolean) => {
			const fg = groupOf.get(from);
			const tg = groupOf.get(to);
			if (fg == null || tg == null || fg === tg) return;
			g.setEdge(String(fg), String(tg), { label: event, global }, `${from}|${event}|${to}`);
		};
		for (const s of model.states)
			for (const t of s.transitions) addEdge(s.name, t.event, t.to_state, false);

		dagre.layout(g);

		const nodes: Node[] = groups.map((grp, i) => {
			const n = g.node(String(i));
			const x = n.x - n.width / 2;
			const y = n.y - n.height / 2;
			return {
				id: grp.states[0],
				label: grp.states[0],
				x,
				y,
				w: n.width,
				h: n.height,
				start: grp.states[0] === model.start_state,
				any: false,
				chain:
					grp.states.length > 1
						? grp.states.map((s, j) => ({
								name: s,
								event: j < grp.events.length ? grp.events[j] : ''
							}))
						: undefined
			};
		});

		const edges: Edge[] = g.edges().map((e) => {
			const d = g.edge(e) as { points: { x: number; y: number }[]; label: string; global: boolean };
			const mid = d.points[Math.floor(d.points.length / 2)] ?? { x: 0, y: 0 };
			const fg = Number(e.v);
			const tg = Number(e.w);
			return {
				points: d.points,
				label: d.label,
				global: d.global,
				from: groups[fg].states[0],
				to: groups[tg].states[0],
				lx: mid.x,
				ly: mid.y
			};
		});

		// global transitions: short incoming arrows above each target, spread horizontally when multiple
		const nodeById = new Map(nodes.map((n) => [n.id, n]));
		const globalsByTarget = new Map<string, { event: string }[]>();
		for (const t of model.global_transitions) {
			(
				globalsByTarget.get(t.to_state) ?? globalsByTarget.set(t.to_state, []).get(t.to_state)!
			).push({ event: t.event });
		}
		for (const [targetName, gtrans] of globalsByTarget) {
			// find the node whose group contains this target state
			const targetGroup = groupOf.get(targetName);
			if (targetGroup == null) continue;
			const target = nodes[targetGroup];
			if (!target) continue;
			const n = gtrans.length;
			gtrans.forEach((gt, j) => {
				const cx = target.x + (target.w * (j + 1)) / (n + 1);
				const yOff = 28 + (n - 1 - j) * 22; // stagger: first global highest, last lowest
				edges.push({
					points: [
						{ x: cx, y: target.y - yOff },
						{ x: cx, y: target.y }
					],
					label: '★ ' + gt.event,
					global: true,
					from: ANY,
					to: target.id,
					lx: cx,
					ly: target.y - yOff + 12
				});
			});
		}

		const gl = g.graph();
		const edgeGroups: [Set<string>, Set<string>][] = edges.map((e) => {
			const fg =
				e.from === ANY
					? new Set<string>()
					: new Set(groups.find((grp) => grp.states[0] === e.from)?.states ?? []);
			const tg = new Set(groups.find((grp) => grp.states[0] === e.to)?.states ?? []);
			return [fg, tg];
		});
		return { nodes, edges, edgeGroups, width: gl.width ?? 100, height: gl.height ?? 100 };
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
	// default view: 100% zoom, centred horizontally, near the top
	const home = $derived({ tx: (cw - layout.width) / 2, ty: 20, k: 1 });
	let view = $state<{ tx: number; ty: number; k: number } | null>(null);
	const cur = $derived(view ?? home);

	// re-fit whenever the layout (i.e. the model) changes
	$effect(() => {
		void layout;
		view = null;
	});

	// size the body to exactly fill the viewport below it — robust to the header height (vs a fixed
	// magic offset, which left a sliver of page scroll)
	let bodyEl = $state<HTMLElement>();
	let bodyTop = $state(0);
	$effect(() => {
		const measure = () => {
			if (bodyEl) bodyTop = bodyEl.getBoundingClientRect().top + window.scrollY;
		};
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
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
	let moved = false; // whether the current canvas drag actually panned (vs a plain click)
	function down(e: MouseEvent) {
		moved = false;
		drag = { x: e.clientX, y: e.clientY, tx: cur.tx, ty: cur.ty };
	}

	// drag the panel's top edge to resize its height
	let resizing = $state<{ y: number; h: number } | null>(null);
	function resizeDown(e: MouseEvent) {
		e.preventDefault();
		resizing = { y: e.clientY, h: panelHeight };
	}

	function move(e: MouseEvent) {
		if (resizing) {
			panelHeight = clamp(resizing.h + (resizing.y - e.clientY), 120, 640);
			return;
		}
		if (!drag) return;
		if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) moved = true;
		view = { tx: drag.tx + (e.clientX - drag.x), ty: drag.ty + (e.clientY - drag.y), k: cur.k };
	}
	function end() {
		// a click on empty canvas (mousedown+up without a pan) clears the selection
		if (drag && !moved) select(null);
		drag = null;
		if (resizing) {
			resizing = null;
			if (browser) localStorage.setItem(SIDEBAR_KEY, String(panelHeight));
		}
	}
</script>

<svelte:window onmousemove={move} onmouseup={end} />

<div class="toolbar">
	<button onclick={() => zoomAround(cw / 2, ch / 2, 1.25)}>+</button>
	<button onclick={() => zoomAround(cw / 2, ch / 2, 0.8)}>−</button>
	<button onclick={() => (view = { ...fit })}>fit</button>
	<button class="cfg-btn" class:active={showCfg} onclick={() => (showCfg = !showCfg)}>⚙</button>
	<span class="dim"
		>{model.states.length} states · {Math.round(cur.k * 100)}% · drag to pan, scroll to zoom</span
	>
	{#if modeTabs}
		<span class="grow"></span>
		{@render modeTabs()}
	{/if}
</div>

{#if showCfg}
	<div class="cfg-panel">
		<label>
			<span>direction</span>
			<div class="seg">
				{#each ['TB', 'BT', 'LR', 'RL'] as d}
					<button
						class:active={layoutCfg.rankdir === d}
						onclick={() => (layoutCfg.rankdir = d as RankDir)}>{d}</button
					>
				{/each}
			</div>
		</label>
		<label>
			<span>ranker</span>
			<div class="seg">
				{#each ['network-simplex', 'tight-tree', 'longest-path'] as r}
					<button
						class:active={layoutCfg.ranker === r}
						onclick={() => (layoutCfg.ranker = r as Ranker)}
						>{r === 'network-simplex'
							? 'simplex'
							: r === 'tight-tree'
								? 'tight'
								: 'longest'}</button
					>
				{/each}
			</div>
		</label>
		<label>
			<span>node sep ({layoutCfg.nodesep})</span>
			<input type="range" min="8" max="80" bind:value={layoutCfg.nodesep} />
		</label>
		<label>
			<span>rank sep ({layoutCfg.ranksep})</span>
			<input type="range" min="16" max="120" bind:value={layoutCfg.ranksep} />
		</label>
		<button class="cfg-reset" onclick={() => (layoutCfg = { ...defaultCfg })}>reset</button>
	</div>
{/if}

<div class="body" bind:this={bodyEl} style="height: calc(100dvh - {bodyTop}px)">
	<!-- drag/wheel are mouse-only enhancements -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="canvas"
		bind:this={canvas}
		bind:clientWidth={cw}
		bind:clientHeight={ch}
		onmousedown={down}
		onwheel={wheel}
		oncontextmenu={(e) => e.preventDefault()}
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
				<marker
					id="arrowsel"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
				</marker>
			</defs>

			<g transform="translate({cur.tx} {cur.ty}) scale({cur.k})">
				{#each layout.edges as e, i (i)}
					{@const hot =
						selected != null &&
						(layout.edgeGroups[i][0].has(selected) || layout.edgeGroups[i][1].has(selected))}
					<polyline
						points={line(e.points)}
						fill="none"
						stroke={hot ? 'var(--accent)' : e.global ? 'var(--var)' : '#888'}
						stroke-width={hot ? 2.2 : 1.3}
						marker-end="url(#{hot ? 'arrowsel' : e.global ? 'arrowg' : 'arrow'})"
						opacity={selected == null ? 0.8 : hot ? 1 : 0.18}
					/>
					<text
						x={e.lx}
						y={e.ly - 3}
						class="elabel"
						class:hot
						text-anchor="middle"
						opacity={selected == null || hot ? 1 : 0.2}
						>{e.label === 'FINISHED' ? '' : e.label}</text
					>
				{/each}

				{#each layout.nodes as n (n.id)}
					<g>
						<rect
							x={n.x}
							y={n.y}
							width={n.w}
							height={n.h}
							rx="5"
							class="node"
							class:start={n.start}
							class:any={n.any}
							class:sel={n.chain ? n.chain.some((s) => s.name === selected) : selected === n.id}
						/>
						{#if n.chain}
							{#each n.chain as s, j (s.name)}
								{#if j > 0}
									<line
										x1={n.x + 6}
										y1={n.y + PAD_Y + j * ROW_H}
										x2={n.x + n.w - 6}
										y2={n.y + PAD_Y + j * ROW_H}
										class="chain-divider"
									/>
								{/if}
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<rect
									x={n.x}
									y={n.y + PAD_Y + j * ROW_H}
									width={n.w}
									height={ROW_H}
									class="chain-slot"
									class:sel={selected === s.name}
									onclick={() => {
										if (!moved) select(s.name);
									}}
								/>
								<text
									x={n.x + n.w / 2}
									y={n.y + PAD_Y + j * ROW_H + 14}
									text-anchor="middle"
									class="nlabel"
									class:sel={selected === s.name}
									style="pointer-events: none">{s.name}</text
								>
								{#if s.event && s.event !== 'FINISHED' && j < n.chain.length - 1}
									<text x={n.x + n.w + 4} y={n.y + PAD_Y + (j + 1) * ROW_H - 2} class="chain-arrow"
										>↓</text
									>
									<text x={n.x + n.w + 14} y={n.y + PAD_Y + (j + 1) * ROW_H + 2} class="chain-event"
										>{s.event}</text
									>
								{/if}
							{/each}
						{:else}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<rect
								x={n.x}
								y={n.y}
								width={n.w}
								height={n.h}
								rx="5"
								class="node-slot"
								onclick={() => {
									if (!n.any && !moved) select(n.id);
								}}
							/>
							<text
								x={n.x + n.w / 2}
								y={n.y + n.h / 2 + 4}
								text-anchor="middle"
								class="nlabel"
								class:sel={selected === n.id}
								style="pointer-events: none">{n.label}</text
							>
						{/if}
					</g>
				{/each}
			</g>
		</svg>
	</div>

	<aside class="panel" style="height: {panelHeight}px">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="resizer" onmousedown={resizeDown} class:active={!!resizing}></div>
		{#if selectedState}
			<div class="sbhead">
				<span class="state">{selectedState.name}</span>
				<button class="close" onclick={() => select(null)} aria-label="close">×</button>
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
						{#if t.to_state}
							<button class="state link" onclick={() => select(t.to_state)}>{t.to_state}</button>
						{:else}
							<span class="cmt">(none)</span>
						{/if}
					</div>
				{/each}
				{#if !selectedState.actions.length && !selectedState.transitions.length}
					<div class="cmt">(no actions or transitions)</div>
				{/if}
			</div>
		{:else}
			<div class="empty dim">click a state to see its actions & transitions</div>
		{/if}
	</aside>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem var(--pad-x);
	}
	.grow {
		flex: 1;
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
	.cfg-btn {
		font-size: 1.1rem;
		line-height: 1;
	}
	.cfg-btn.active {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}
	.cfg-panel {
		display: flex;
		gap: 1.2rem;
		padding: 0.5rem var(--pad-x);
		border-bottom: 1px solid #333;
		background: var(--panel);
		flex-wrap: wrap;
	}
	.cfg-panel label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--dim);
	}
	.cfg-panel .seg {
		display: flex;
		gap: 2px;
	}
	.cfg-panel .seg button {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid #333;
		border-radius: 3px;
		padding: 2px 8px;
		font-size: 0.75rem;
		cursor: pointer;
		width: auto;
		height: auto;
	}
	.cfg-panel .seg button.active {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}
	.cfg-panel input[type='range'] {
		width: 100px;
		accent-color: var(--accent);
	}
	.cfg-reset {
		align-self: flex-end;
		background: var(--bg);
		color: var(--fg);
		border: 1px solid #333;
		border-radius: 3px;
		padding: 2px 8px;
		font-size: 0.75rem;
		cursor: pointer;
		width: auto;
		height: auto;
	}
	.cfg-reset:hover {
		border-color: var(--accent);
	}
	.toolbar .dim {
		margin-left: 0.5rem;
		font-size: 0.85rem;
	}
	.body {
		display: flex;
		flex-direction: column;
		/* height is set inline from the measured top offset (see component) */
	}
	.canvas {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}
	.canvas.grabbing {
		cursor: grabbing;
	}
	.node.sel {
		stroke: var(--accent);
		stroke-width: 2.5;
	}
	.panel {
		position: relative;
		flex-shrink: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-top: 1px solid #333;
		background: var(--bg);
	}
	.empty {
		padding: 1rem;
	}
	.resizer {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 6px;
		cursor: row-resize;
		z-index: 2;
	}
	.resizer:hover,
	.resizer.active {
		background: var(--accent);
		opacity: 0.5;
	}
	.sbhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid #333;
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
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.8rem 1rem 2rem;
		font-family: ui-monospace, Menlo, monospace;
		font-size: 14px;
		line-height: 1.65;
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
		font-size: 13px;
	}
	.elabel {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 11px;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3px;
	}
	.elabel.hot {
		fill: var(--accent);
		font-weight: 600;
	}
	.chain-arrow {
		fill: var(--dim);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 10px;
	}
	.chain-event {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 10px;
		opacity: 0.7;
	}
	.nlabel.sel {
		fill: var(--accent);
	}
	.chain-divider {
		stroke: #444;
		stroke-width: 1;
		pointer-events: none;
	}
	.node-slot {
		fill: transparent;
		cursor: pointer;
	}
	.node-slot:hover {
		fill: color-mix(in srgb, var(--fg) 8%, transparent);
	}
	.chain-slot {
		fill: transparent;
		cursor: pointer;
	}
	.chain-slot.sel {
		fill: color-mix(in srgb, var(--accent) 15%, transparent);
	}
	.chain-slot:hover {
		fill: color-mix(in srgb, var(--fg) 8%, transparent);
	}
</style>
