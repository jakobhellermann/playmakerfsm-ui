<script module lang="ts">
	import { browser } from '$app/environment';

	// bottom pseudocode panel height is drag-resizable and persisted in localStorage
	const SIDEBAR_KEY = 'fsm:graph-panel-h';
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

	const CHAR = 6.6;
	const HEADER = 24; // state-name header height
	const ROW = 16; // per-transition row height
	const PAD = 12;
	const txt = (s: string) => s.length * CHAR;
	const ROW_H = 20; // chain state row height
	const PAD_Y = 8; // chain box vertical padding

	// a state inside a chain node: its name + the event that transitions to the next state (empty on last)
	type ChainState = { name: string; event: string };

	// ty = label y inside the box; (px,py) = where the edge leaves (right edge per row, or bottom-centre
	// when the state has a single out-transition so it drops straight down)
	type Row = { event: string; to: string; ty: number; px: number; py: number; down: boolean };

	type Node = {
		id: string;
		x: number;
		y: number;
		w: number;
		h: number;
		start: boolean;
		any: boolean;
		rows: Row[];
		/** present when this node is a collapsed linear chain */
		chain?: ChainState[];
	};
	type Edge = {
		from: string;
		to: string;
		global: boolean;
		// port-based state transitions:
		down?: boolean;
		sx?: number;
		sy?: number;
		tx?: number;
		ty?: number;
		// global transition arrows (per-target):
		points?: { x: number; y: number }[];
		label?: string;
		lx?: number;
		ly?: number;
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
			if (from === to || from === ANY || to === ANY) return false;
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

		// transitions of a state that leave its group (visible ports); intra-chain transitions are hidden
		const transOf = (id: string) => {
			const raw =
				id === ANY
					? model.global_transitions
					: (model.states.find((s) => s.name === id)?.transitions ?? []);
			return raw.filter((t) => groupOf.get(id) !== groupOf.get(t.to_state));
		};

		// ── dagre layout on groups (compact) — edges only drive ordering ──
		const sizeOf = (label: string, trans: { event: string }[], chainLen: number) => ({
			width: Math.max(txt(label), ...trans.map((t) => txt(t.event) + 16), 40) + PAD * 2,
			height:
				chainLen > 1
					? chainLen * ROW_H + PAD_Y * 2
					: HEADER + trans.length * ROW + (trans.length ? 6 : 0)
		});
		const g = new dagre.graphlib.Graph();
		g.setGraph({ rankdir: 'TB', nodesep: 34, ranksep: 64, marginx: 16, marginy: 16 });
		g.setDefaultEdgeLabel(() => ({}));
		groups.forEach((grp, i) => {
			const label = grp.states[0];
			const trans = transOf(label);
			g.setNode(String(i), sizeOf(label, trans, grp.states.length));
		});
		const link = (from: string, to: string) => {
			const fg = groupOf.get(from);
			const tg = groupOf.get(to);
			if (fg != null && tg != null && fg !== tg) g.setEdge(String(fg), String(tg));
		};
		for (const s of model.states) for (const t of s.transitions) link(s.name, t.to_state);
		dagre.layout(g);

		const nodes: Node[] = groups.map((grp, i) => {
			const n = g.node(String(i));
			const left = n.x - n.width / 2;
			const top = n.y - n.height / 2;
			const label = grp.states[0];
			const trans = transOf(label);
			const single = trans.length === 1;
			const chain = grp.states.length > 1;
			const rows: Row[] = trans.map((t, i) => {
				const ty = chain ? top + PAD_Y + i * ROW + ROW / 2 : top + HEADER + i * ROW + ROW / 2;
				// single out-edge leaves straight down from the bottom; multi-edge ports get a side below
				return {
					event: t.event,
					to: t.to_state,
					ty,
					px: left + n.width / 2,
					py: top + n.height,
					down: single
				};
			});
			return {
				id: label,
				x: left,
				y: top,
				w: n.width,
				h: n.height,
				start: grp.states[0] === model.start_state,
				any: false,
				rows,
				chain: chain
					? grp.states.map((s, j) => ({
							name: s,
							event: j < grp.events.length ? grp.events[j] : ''
						}))
					: undefined
			};
		});
		const byId = new Map(nodes.map((n) => [n.id, n]));

		const edges: Edge[] = [];
		for (const n of nodes)
			for (const r of n.rows) {
				// resolve target: first state of the target's group
				const tg = groupOf.get(r.to);
				if (tg == null) continue;
				const target = nodes[tg];
				if (!target) continue;
				const tgtCx = target.x + target.w / 2;
				if (!r.down) {
					// leave from the side (at the row's y) that's nearer the target
					const right = tgtCx >= n.x + n.w / 2;
					r.px = right ? n.x + n.w : n.x;
					r.py = r.ty;
				}
				edges.push({
					from: n.id,
					to: target.id,
					global: n.any,
					down: r.down,
					sx: r.px,
					sy: r.py,
					tx: tgtCx,
					ty: target.y
				});
			}

		// global transitions: short incoming arrows above each target, spread horizontally when multiple
		const globalsByTarget = new Map<string, { event: string }[]>();
		for (const t of model.global_transitions) {
			(
				globalsByTarget.get(t.to_state) ?? globalsByTarget.set(t.to_state, []).get(t.to_state)!
			).push({ event: t.event });
		}
		for (const [targetName, gtrans] of globalsByTarget) {
			const targetGroup = groupOf.get(targetName);
			if (targetGroup == null) continue;
			const target = nodes[targetGroup];
			if (!target) continue;
			const n = gtrans.length;
			gtrans.forEach((gt, j) => {
				const cx = target.x + (target.w * (j + 1)) / (n + 1);
				const yOff = 28 + (n - 1 - j) * 22;
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

		// for hot-detection: which group states are in
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

	// cubic curve to the target's top-centre: straight down for a lone out-edge, else leaving the side
	// (left or right) toward the target; global arrows are 2-point polylines rendered separately
	const edgePath = (e: Edge) => {
		if (e.down)
			return `M ${e.sx!} ${e.sy!} C ${e.sx!} ${e.sy! + 40}, ${e.tx!} ${e.ty! - 40}, ${e.tx!} ${e.ty!}`;
		const dx = e.tx! < e.sx! ? -50 : 50;
		return `M ${e.sx!} ${e.sy!} C ${e.sx! + dx} ${e.sy!}, ${e.tx!} ${e.ty! - 50}, ${e.tx!} ${e.ty!}`;
	};

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
	<span class="dim"
		>{model.states.length} states · {Math.round(cur.k * 100)}% · drag to pan, scroll to zoom</span
	>
	{#if modeTabs}
		<span class="grow"></span>
		{@render modeTabs()}
	{/if}
</div>

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
					{#if e.points}
						<!-- global transition: short polyline with label -->
						<polyline
							points={line(e.points)}
							fill="none"
							stroke={hot ? 'var(--accent)' : 'var(--var)'}
							stroke-width={hot ? 2 : 1.2}
							marker-end="url(#{hot ? 'arrowsel' : 'arrowg'})"
							opacity={selected == null ? 0.7 : hot ? 1 : 0.15}
						/>
						<text
							x={e.lx}
							y={e.ly}
							class="elabel"
							text-anchor="middle"
							opacity={selected == null || hot ? 1 : 0.2}>{e.label}</text
						>
					{:else}
						<path
							d={edgePath(e)}
							fill="none"
							stroke={hot ? 'var(--accent)' : '#888'}
							stroke-width={hot ? 2 : 1.2}
							marker-end="url(#{hot ? 'arrowsel' : 'arrow'})"
							opacity={selected == null ? 0.55 : hot ? 1 : 0.1}
						/>
					{/if}
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
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<text
									x={n.x + n.w / 2}
									y={n.y + PAD_Y + j * ROW_H + 14}
									text-anchor="middle"
									class="nlabel"
									class:sel={selected === s.name}
									onclick={() => {
										if (!moved) select(s.name);
									}}>{s.name}</text
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
							<text x={n.x + n.w / 2} y={n.y + 16} text-anchor="middle" class="nlabel">{n.id}</text>
						{/if}
						{#each n.rows as r (r.event + r.to)}
							{@const lit = selected === n.id || selected === r.to}
							<text x={n.x + 10} y={r.ty + 3} class="erow" class:hot={lit}>{r.event}</text>
							<circle cx={r.px} cy={r.py} r="2" class="port" class:hot={lit} />
						{/each}
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
						<button class="state link" onclick={() => select(t.to_state)}>{t.to_state}</button>
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
		padding: 0.5rem 1.25rem;
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
	.clickable {
		cursor: pointer;
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
	.nlabel.sel {
		fill: var(--accent);
	}
	.erow {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 11px;
	}
	.erow.hot {
		fill: var(--accent);
	}
	.port {
		fill: #888;
	}
	.port.hot {
		fill: var(--accent);
	}
	.chain-divider {
		stroke: #444;
		stroke-width: 1;
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
</style>
