<script module lang="ts">
	import { browser } from '$app/environment';

	// bottom pseudocode panel height is drag-resizable and persisted in localStorage
	const SIDEBAR_KEY = 'fsm:graph-panel-h';
	const CFG_KEY = 'fsm:graph-layout-cfg';
	let panelHeight = $state((browser && Number(localStorage.getItem(SIDEBAR_KEY))) || 320);
</script>

<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import dagre from '@dagrejs/dagre';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { FsmModel } from '$lib/model';
	import StateBody from './StateBody.svelte';

	// `modeTabs` lets the detail view drop its mode switcher into the toolbar (same row as +/−/fit)
	let { model, modeTabs }: { model: FsmModel; modeTabs?: Snippet } = $props();

	type RankDir = 'TB' | 'LR';
	type Ranker = 'network-simplex' | 'tight-tree' | 'longest-path';
	// two orthogonal axes:
	//  layout — where nodes sit: `computed` (dagre auto-layout, collapses linear chains) or `editor`
	//           (raw PlayMaker editor rects, one node per state)
	//  edgeStyle — how edges/labels look: `routed` (label at the line midpoint) or `side`/`bottom`
	//           (out-transitions as labelled ports leaving the side resp. the bottom edge)
	type LayoutMode = 'computed' | 'editor';
	type EdgeStyle = 'routed' | 'side' | 'bottom';
	type LayoutCfg = {
		layout: LayoutMode;
		rankdir: RankDir;
		ranker: Ranker;
		nodesep: number;
		ranksep: number;
		edgeStyle: EdgeStyle;
	};
	const defaultCfg: LayoutCfg = {
		layout: 'editor',
		rankdir: 'TB',
		ranker: 'network-simplex',
		nodesep: 28,
		ranksep: 46,
		edgeStyle: 'side'
	};
	let layoutCfg = $state<LayoutCfg>(
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

	const CHAR = 6.6; // port-mode event/label text metric
	const CHAR_WIDE = 7.3; // routed-mode node width metric
	const HEADER = 24; // state-name header height
	const ROW = 16; // per-transition row height
	const PAD = 12;
	const txt = (s: string) => s.length * CHAR;
	const ROW_H = 20; // chain state row height
	const PAD_Y = 0; // chain box vertical padding

	// a state inside a chain node: its name + the event that transitions to the next state (empty on last)
	type ChainState = { name: string; event: string };

	// ty = label y inside the box; (px,py) = the port the edge leaves from; `down` (side mode) means it
	// drops straight from the bottom centre rather than leaving the side
	type Row = { event: string; to: string; ty: number; px: number; py: number; down?: boolean };
	type Node = {
		id: string;
		label: string;
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
		// port-based state transitions (side/bottom):
		down?: boolean;
		up?: boolean; // target docked at its bottom edge (entered from below) rather than its top
		topPort?: boolean; // bottom mode: source port sits on the top edge and leaves upward
		bow?: number; // side mode: horizontal direction the curve leaves the port (matches the port side)
		sx?: number;
		sy?: number;
		tx?: number;
		ty?: number;
		// dagre-routed transitions + global arrows (polyline + midpoint label):
		points?: { x: number; y: number }[];
		label?: string;
		lx?: number;
		ly?: number;
	};

	const layout = $derived.by(() => {
		const style = layoutCfg.edgeStyle;
		const editor = layoutCfg.layout === 'editor';
		const routed = style === 'routed';
		const port = !routed;

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
		const groups: { states: string[]; events: string[] }[] = [];
		if (editor) {
			// editor layout: one node per state (no chain collapsing) — positions come from the raw rects
			for (const s of model.states) groups.push({ states: [s.name], events: [] });
		} else {
			const visited = new Set<string>();
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
		}
		// no ANY node — global transitions render as incoming arrows above their target
		const groupOf = new Map<string, number>();
		groups.forEach((grp, i) => grp.states.forEach((s) => groupOf.set(s, i)));

		// transitions of a state that leave its group (visible ports); intra-chain transitions are hidden.
		// for chain groups we must look at ALL states, since the exit transition may come from the last
		// state in the chain, not the first.
		const transOf = (id: string) => {
			const grp = groupOf.get(id);
			if (grp == null) return [];
			const raw = model.states
				.filter((s) => groupOf.get(s.name) === grp)
				.flatMap((s) => s.transitions);
			return raw.filter((t) => grp !== groupOf.get(t.to_state));
		};

		// ── dagre layout on groups (compact) ──
		// routed mode keeps a multigraph and lets dagre route+label each edge; port modes use a plain
		// graph where edges only drive node ordering (ports/curves are computed by hand below)
		// width fits the widest state name in the group (a chain renders all of them, not just the head)
		const sizeOf = (names: string[], trans: { event: string }[], chainLen: number) => ({
			width:
				Math.max(...names.map((s) => txt(s) + 4), ...trans.map((t) => txt(t.event) + 16), 40) +
				PAD * 2,
			height:
				chainLen > 1
					? chainLen * ROW_H + PAD_Y * 2 + trans.length * ROW + (trans.length ? 6 : 0)
					: HEADER + trans.length * ROW + (trans.length ? 6 : 0)
		});
		// node geometry: raw editor rects (normalised so the top-left sits near the origin) or a dagre
		// layout. the dagre path also produces the routed-edge polylines (collected into `routedEdges`).
		let posList: { x: number; y: number; w: number; h: number }[];
		let width = 100;
		let height = 100;
		const routedEdges: Edge[] = [];
		if (editor) {
			const raw = groups.map((grp) => model.states.find((s) => s.name === grp.states[0])!.position);
			const minX = Math.min(...raw.map((p) => p.x));
			const minY = Math.min(...raw.map((p) => p.y));
			// keep the raw rect for `edge` (faithful editor look); size to fit name + ports for side/bottom
			posList = raw.map((p, i) => {
				const x = p.x - minX + 20;
				const y = p.y - minY + 20;
				if (port) {
					const sz = sizeOf(groups[i].states, transOf(groups[i].states[0]), 1);
					return { x, y, w: sz.width, h: sz.height };
				}
				return { x, y, w: p.w, h: p.h };
			});
			width = Math.max(...posList.map((p) => p.x + p.w), 80) + 20;
			height = Math.max(...posList.map((p) => p.y + p.h), 80) + 20;
		} else {
			const g = new dagre.graphlib.Graph(routed ? { multigraph: true } : undefined);
			g.setGraph({
				rankdir: layoutCfg.rankdir,
				ranker: layoutCfg.ranker,
				nodesep: layoutCfg.nodesep,
				ranksep: layoutCfg.ranksep,
				marginx: 16,
				marginy: 16
			});
			g.setDefaultEdgeLabel(() => ({}));
			groups.forEach((grp, i) => {
				const label = grp.states[0];
				if (port) {
					g.setNode(String(i), sizeOf(grp.states, transOf(label), grp.states.length));
				} else {
					const w = Math.max(54, ...grp.states.map((s) => s.length * CHAR_WIDE + 22));
					const h = grp.states.length === 1 ? 30 : grp.states.length * ROW_H + PAD_Y * 2;
					g.setNode(String(i), { width: w, height: h });
				}
			});
			if (routed) {
				const addEdge = (from: string, event: string, to: string, global: boolean) => {
					const fg = groupOf.get(from);
					const tg = groupOf.get(to);
					if (fg == null || tg == null || fg === tg) return;
					g.setEdge(String(fg), String(tg), { label: event, global }, `${from}|${event}|${to}`);
				};
				for (const s of model.states)
					for (const t of s.transitions) addEdge(s.name, t.event, t.to_state, false);
			} else {
				const link = (from: string, to: string) => {
					const fg = groupOf.get(from);
					const tg = groupOf.get(to);
					if (fg != null && tg != null && fg !== tg) g.setEdge(String(fg), String(tg));
				};
				for (const s of model.states) for (const t of s.transitions) link(s.name, t.to_state);
			}
			dagre.layout(g);
			posList = groups.map((_, i) => {
				const n = g.node(String(i));
				return { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height };
			});
			if (routed) {
				for (const e of g.edges()) {
					const d = g.edge(e) as {
						points: { x: number; y: number }[];
						label: string;
						global: boolean;
					};
					const mid = d.points[Math.floor(d.points.length / 2)] ?? { x: 0, y: 0 };
					routedEdges.push({
						points: d.points,
						label: d.label,
						global: d.global,
						from: groups[Number(e.v)].states[0],
						to: groups[Number(e.w)].states[0],
						lx: mid.x,
						ly: mid.y
					});
				}
			}
			const gl = g.graph();
			width = gl.width ?? 100;
			height = gl.height ?? 100;
		}

		const nodes: Node[] = groups.map((grp, i) => {
			const { x: left, y: top, w, h } = posList[i];
			const label = grp.states[0];
			const chain = grp.states.length > 1;
			let rows: Row[] = [];
			if (port) {
				const trans = transOf(label);
				const single = trans.length === 1;
				rows = trans.map((t, idx) => ({
					event: t.event,
					to: t.to_state,
					ty: chain
						? top + PAD_Y + grp.states.length * ROW_H + idx * ROW + ROW / 2
						: top + HEADER + idx * ROW + ROW / 2,
					px: left + w / 2, // placeholder; the port slot is assigned below
					py: top + h,
					// in side mode a lone out-edge drops straight down from the bottom centre
					down: style === 'side' && single
				}));
			}
			return {
				id: label,
				label,
				x: left,
				y: top,
				w,
				h,
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

		const edges: Edge[] = [...routedEdges];
		if (routed && editor) {
			// editor layout has no dagre routing: straight labelled lines between state boxes,
			// endpoints trimmed to each box border along the centre-to-centre line
			const byId = new Map(nodes.map((n) => [n.id, n]));
			const cx = (n: Node) => n.x + n.w / 2;
			const cy = (n: Node) => n.y + n.h / 2;
			const border = (n: Node, tx: number, ty: number) => {
				const dx = tx - cx(n);
				const dy = ty - cy(n);
				if (dx === 0 && dy === 0) return { x: cx(n), y: cy(n) };
				const t = Math.min(
					dx !== 0 ? n.w / 2 / Math.abs(dx) : Infinity,
					dy !== 0 ? n.h / 2 / Math.abs(dy) : Infinity
				);
				return { x: cx(n) + dx * t, y: cy(n) + dy * t };
			};
			for (const s of model.states) {
				const from = byId.get(s.name);
				if (!from) continue;
				for (const t of s.transitions) {
					const to = byId.get(t.to_state);
					if (!to) continue;
					const p0 = border(from, cx(to), cy(to));
					const p1 = border(to, cx(from), cy(from));
					edges.push({
						points: [p0, p1],
						label: t.event,
						global: false,
						from: s.name,
						to: t.to_state,
						lx: (p0.x + p1.x) / 2,
						ly: (p0.y + p1.y) / 2
					});
				}
			}
		} else if (!routed) {
			const cx = (m: Node) => m.x + m.w / 2;
			const byId = new Map(nodes.map((n) => [n.id, n]));
			const srcRow = new Map<Edge, Row>(); // bottom mode: edge → its source row (to re-place the port)
			for (const n of nodes) {
				const valid = n.rows
					.map((r) => ({ r, target: nodes[groupOf.get(r.to)!] }))
					.filter((o): o is { r: Row; target: Node } => !!o.target);
				if (style === 'bottom') {
					// edges to a target below leave the bottom edge; back-edges (target above) leave the TOP
					// edge and rise to the target's bottom — so flow stays vertical in both directions. each
					// group spreads left→right by target x so its edges fan out without crossing.
					const isUp = (o: { target: Node }) => o.target.y + o.target.h <= n.y + n.h;
					const place = (arr: { r: Row; target: Node }[], py: number, up: boolean) => {
						for (const o of arr) {
							o.r.py = py;
							const e: Edge = {
								from: n.id,
								to: o.target.id,
								global: n.any,
								up,
								topPort: up,
								sx: o.r.px,
								sy: py,
								tx: cx(o.target),
								ty: up ? o.target.y + o.target.h : o.target.y
							};
							edges.push(e);
							srcRow.set(e, o.r);
						}
					};
					place(
						valid.filter((o) => !isUp(o)),
						n.y + n.h,
						false
					);
					place(valid.filter(isUp), n.y, true);
				} else {
					// side: a lone out-edge drops straight down; otherwise leave from the side (at the row's
					// y) that's nearer the target
					for (const { r, target } of valid) {
						const tgtCx = cx(target);
						const right = tgtCx >= n.x + n.w / 2;
						if (!r.down) {
							r.px = right ? n.x + n.w : n.x;
							r.py = r.ty;
						}
						const up = target.y + target.h <= r.py;
						edges.push({
							from: n.id,
							to: target.id,
							global: n.any,
							down: r.down,
							up,
							// leave the port toward its own side, so a right-edge port visibly exits rightward
							// even when the target sits almost straight below (tx barely past the node centre)
							bow: right ? 50 : -50,
							sx: r.px,
							sy: r.py,
							tx: tgtCx,
							ty: up ? target.y + target.h : target.y
						});
					}
				}
			}

			// re-pack each node's top and bottom edges: outgoing ports and incoming dock points share the
			// same physical edge, so give them distinct slots (ordered by the other end's x) instead of both
			// gravitating to the centre — otherwise an out-port starts exactly where an in-edge lands
			if (style === 'bottom') {
				const portEdges = edges.filter((e) => srcRow.has(e));
				for (const n of nodes) {
					const repack = (items: { e: Edge; out: boolean }[], py: number) => {
						// order by the other end's x; tie-break by the edge's own identity so a bidirectional
						// pair (which ties — both ends are the same node) lands in the SAME lane at both nodes
						// and runs parallel instead of crossing
						const eid = (e: Edge) => e.from + ' ' + e.to;
						items.sort((a, b) => {
							const ka = a.out ? byId.get(a.e.to)! : byId.get(a.e.from)!;
							const kb = b.out ? byId.get(b.e.to)! : byId.get(b.e.from)!;
							return cx(ka) - cx(kb) || eid(a.e).localeCompare(eid(b.e));
						});
						items.forEach((it, k) => {
							const x = n.x + (n.w * (k + 1)) / (items.length + 1);
							if (it.out) {
								it.e.sx = x;
								srcRow.get(it.e)!.px = x;
								srcRow.get(it.e)!.py = py;
							} else {
								it.e.tx = x;
							}
						});
					};
					const out = portEdges.filter((e) => e.from === n.id);
					const inc = portEdges.filter((e) => e.to === n.id);
					// bottom edge: out-edges leaving downward + in-edges arriving from below
					repack(
						[
							...out.filter((e) => !e.topPort).map((e) => ({ e, out: true })),
							...inc.filter((e) => e.up).map((e) => ({ e, out: false }))
						],
						n.y + n.h
					);
					// top edge: out-edges leaving upward + in-edges arriving from above
					repack(
						[
							...out.filter((e) => e.topPort).map((e) => ({ e, out: true })),
							...inc.filter((e) => !e.up).map((e) => ({ e, out: false }))
						],
						n.y
					);
				}
			}
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

		const edgeGroups: [Set<string>, Set<string>][] = edges.map((e) => {
			const fg =
				e.from === ANY
					? new Set<string>()
					: new Set(groups.find((grp) => grp.states[0] === e.from)?.states ?? []);
			const tg = new Set(groups.find((grp) => grp.states[0] === e.to)?.states ?? []);
			return [fg, tg];
		});

		return { nodes, edges, edgeGroups, width, height };
	});

	const line = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

	// cubic curve from a port to the target: bottom/lone ports leave straight down, side ports leave
	// horizontally toward their own side; the target is approached from above (top dock) or, for a
	// back-edge, from below (bottom dock, `up`). distinct out/in slots (see re-pack pass) already keep
	// opposing edges apart, so a vertically-aligned edge stays straight.
	const edgePath = (e: Edge) => {
		const vertical = layoutCfg.edgeStyle === 'bottom' || e.down;
		const off = vertical ? 40 : 50;
		const c1 = vertical
			? `${e.sx!} ${e.sy! + (e.topPort ? -40 : 40)}`
			: `${e.sx! + (e.bow ?? (e.tx! < e.sx! ? -50 : 50))} ${e.sy!}`;
		const c2 = e.up ? `${e.tx!} ${e.ty! + off}` : `${e.tx!} ${e.ty! - off}`;
		return `M ${e.sx!} ${e.sy!} C ${c1}, ${c2}, ${e.tx!} ${e.ty!}`;
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

	// re-fit whenever the model (i.e. the FSM) changes — not on config tweaks,
	// so adjusting ranker/seps doesn't lose pan/zoom state
	let lastCentered: string | null = null;
	$effect(() => {
		void model;
		view = null;
		lastCentered = null;
	});

	// when the selected state changes (sidebar click or a ?state= deep link), pan it into view if it's
	// off-screen — keep the current zoom, don't disturb the view if it's already visible
	$effect(() => {
		const sel = selected;
		const w = cw,
			h = ch,
			nodes = layout.nodes;
		if (!sel) {
			lastCentered = null;
			return;
		}
		if (!w || !h || sel === lastCentered) return;
		const n = nodes.find((m) => m.id === sel || m.chain?.some((s) => s.name === sel));
		if (!n) return;
		lastCentered = sel;
		untrack(() => {
			const k = cur.k;
			const m = 24;
			const x0 = cur.tx + n.x * k;
			const y0 = cur.ty + n.y * k;
			if (x0 >= m && y0 >= m && x0 + n.w * k <= w - m && y0 + n.h * k <= h - m) return;
			view = { tx: w / 2 - (n.x + n.w / 2) * k, ty: h / 2 - (n.y + n.h / 2) * k, k };
		});
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
	// coalesce wheel events to one zoom per animation frame: trackpads fire far faster than 60 Hz and
	// each `view` write forces a synchronous repaint of the whole SVG. summed deltas compose exactly
	// (exp is multiplicative), so batching is lossless.
	let wheelAccum = 0;
	let wheelPos = { x: 0, y: 0 };
	let wheelRaf = 0;
	function wheel(e: WheelEvent) {
		e.preventDefault();
		const rect = canvas?.getBoundingClientRect();
		if (!rect) return;
		wheelPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		wheelAccum += e.deltaY;
		if (!wheelRaf)
			wheelRaf = requestAnimationFrame(() => {
				wheelRaf = 0;
				zoomAround(wheelPos.x, wheelPos.y, Math.exp(-wheelAccum * 0.0015));
				wheelAccum = 0;
			});
	}

	// pan/zoom via pointer events (mouse, touch, pen). one pointer pans; two pinch-zoom.
	const pointers = new Map<number, { x: number; y: number }>();
	let drag = $state<{ x: number; y: number; tx: number; ty: number } | null>(null);
	let pinch: { dist: number; cx: number; cy: number; k: number; tx: number; ty: number } | null =
		null;
	let moved = false; // whether the current gesture actually moved (vs a plain tap/click)
	function startPinch() {
		const rect = canvas?.getBoundingClientRect();
		const [a, b] = [...pointers.values()];
		pinch = {
			dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
			cx: (a.x + b.x) / 2 - (rect?.left ?? 0),
			cy: (a.y + b.y) / 2 - (rect?.top ?? 0),
			k: cur.k,
			tx: cur.tx,
			ty: cur.ty
		};
	}
	function down(e: PointerEvent) {
		if (e.button > 0) return; // ignore right/middle mouse buttons
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		moved = false;
		if (pointers.size >= 2) {
			startPinch();
			drag = null;
			return;
		}
		drag = { x: e.clientX, y: e.clientY, tx: cur.tx, ty: cur.ty };
	}

	// drag the panel's top edge to resize its height
	let resizing = $state<{ y: number; h: number } | null>(null);
	function resizeDown(e: PointerEvent) {
		e.preventDefault();
		resizing = { y: e.clientY, h: panelHeight };
	}

	function move(e: PointerEvent) {
		if (resizing) {
			panelHeight = clamp(resizing.h + (resizing.y - e.clientY), 120, 640);
			return;
		}
		if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pinch && pointers.size >= 2) {
			const rect = canvas?.getBoundingClientRect();
			const [a, b] = [...pointers.values()];
			const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
			const midx = (a.x + b.x) / 2 - (rect?.left ?? 0);
			const midy = (a.y + b.y) / 2 - (rect?.top ?? 0);
			const k = clamp((pinch.k * dist) / pinch.dist, 0.1, 4);
			const r = k / pinch.k;
			// pin the graph point under the start midpoint, while following the fingers' midpoint (so a
			// two-finger move also pans)
			view = { tx: midx - (pinch.cx - pinch.tx) * r, ty: midy - (pinch.cy - pinch.ty) * r, k };
			moved = true;
			return;
		}
		if (!drag) return;
		if (Math.abs(e.clientX - drag.x) > 3 || Math.abs(e.clientY - drag.y) > 3) moved = true;
		view = { tx: drag.tx + (e.clientX - drag.x), ty: drag.ty + (e.clientY - drag.y), k: cur.k };
	}
	function end(e: PointerEvent) {
		if (resizing) {
			resizing = null;
			if (browser) localStorage.setItem(SIDEBAR_KEY, String(panelHeight));
			return;
		}
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinch = null;
		if (pointers.size === 0) {
			// a tap/click on empty canvas (no pan) clears the selection
			if (drag && !moved) select(null);
			drag = null;
		} else if (pointers.size === 1) {
			// one finger lifted after a pinch — resume panning from the remaining finger without a jump
			const [p] = [...pointers.values()];
			drag = { x: p.x, y: p.y, tx: cur.tx, ty: cur.ty };
		}
	}
</script>

<svelte:window onpointermove={move} onpointerup={end} onpointercancel={end} />

<div class="toolbar">
	<span class="tb-label">layout</span>
	<div class="seg">
		{#each ['computed', 'editor'] as l}
			<button
				class:active={layoutCfg.layout === l}
				onclick={() => (layoutCfg.layout = l as LayoutMode)}>{l}</button
			>
		{/each}
	</div>
	<span class="tb-label">edges</span>
	<div class="seg">
		{#each ['routed', 'side', 'bottom'] as s}
			<button
				class:active={layoutCfg.edgeStyle === s}
				onclick={() => (layoutCfg.edgeStyle = s as EdgeStyle)}>{s === 'routed' ? 'edge' : s}</button
			>
		{/each}
	</div>
	<button class="cfg-btn" class:active={showCfg} onclick={() => (showCfg = !showCfg)}>⚙</button>
	<button onclick={() => (view = { ...fit })}>fit</button>
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
				{#each ['TB', 'LR'] as d}
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
		onpointerdown={down}
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
						<!-- dagre-routed transition or global arrow: polyline with midpoint label -->
						<polyline
							points={line(e.points)}
							fill="none"
							stroke={hot ? 'var(--accent)' : e.global ? 'var(--var)' : '#888'}
							stroke-width={hot ? 2.2 : 1.3}
							marker-end="url(#{hot ? 'arrowsel' : e.global ? 'arrowg' : 'arrow'})"
							opacity={selected == null ? 0.8 : hot ? 1 : 0.18}
							pointer-events="none"
						/>
						<text
							x={e.lx}
							y={e.ly! - 3}
							class="elabel"
							class:hot
							text-anchor="middle"
							opacity={selected == null || hot ? 1 : 0.2}
							>{e.label === 'FINISHED' ? '' : e.label}</text
						>
					{:else}
						<path
							d={edgePath(e)}
							fill="none"
							stroke={hot ? 'var(--accent)' : '#888'}
							stroke-width={hot ? 2 : 1.2}
							marker-end="url(#{hot ? 'arrowsel' : 'arrow'})"
							opacity={selected == null ? 0.55 : hot ? 1 : 0.1}
							pointer-events="none"
						/>
					{/if}
				{/each}

				{#each layout.nodes as n (n.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
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
							class:clickable={!n.any}
							onclick={() => {
								if (!n.any && !moved) select(n.id);
							}}
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
								y={layoutCfg.edgeStyle === 'routed' ? n.y + n.h / 2 + 4 : n.y + 16}
								text-anchor="middle"
								class="nlabel"
								class:sel={selected === n.id}
								style="pointer-events: none">{n.label}</text
							>
						{/if}
						{#each n.rows as r (r.event + r.to)}
							<!-- a chain's exit transitions all leave from its LAST state, so highlight the ports
							     when that state (not the chain head) is selected -->
							{@const owner = n.chain ? n.chain[n.chain.length - 1].name : n.id}
							{@const lit = selected === owner || selected === r.to}
							{#if layoutCfg.edgeStyle === 'bottom' && n.rows.length > 1}
								<!-- faint wire linking the event row to its (target-ordered) bottom port;
								     a lone transition needs none — its port sits centred under the row -->
								<path
									class="wire"
									class:hot={lit}
									d="M {n.x + 6} {r.ty} C {n.x + 6} {(r.ty + r.py) / 2}, {r.px} {(r.ty + r.py) /
										2}, {r.px} {r.py}"
								/>
							{/if}
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
		<div class="resizer" onpointerdown={resizeDown} class:active={!!resizing}></div>
		{#if selectedState}
			<div class="sbhead">
				<span class="state">{selectedState.name}</span>
				<button class="close" onclick={() => select(null)} aria-label="close">×</button>
			</div>
			<div class="code">
				<StateBody state={selectedState} {model} onnavigate={select} emptyNote />
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
	.toolbar > button {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid #333;
		border-radius: 4px;
		width: 28px;
		height: 26px;
		cursor: pointer;
	}
	.tb-label {
		margin-left: 0.5rem;
		font-size: 0.8rem;
		color: var(--dim);
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
	.seg {
		display: flex;
		gap: 2px;
	}
	.seg button {
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
	.seg button.active {
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
		height: 10px;
		cursor: row-resize;
		z-index: 2;
		touch-action: none;
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
	.node.clickable {
		cursor: pointer;
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
	.elabel {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 11px;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3px;
		pointer-events: none;
	}
	.elabel.hot {
		fill: var(--accent);
		font-weight: 600;
	}
	.erow {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 11px;
		pointer-events: none;
	}
	.erow.hot {
		fill: var(--accent);
	}
	.port {
		fill: #888;
		pointer-events: none;
	}
	.port.hot {
		fill: var(--accent);
	}
	.wire {
		fill: none;
		stroke: #4a4a4a;
		stroke-width: 1;
	}
	.wire.hot {
		stroke: var(--accent);
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
	.chain-arrow {
		fill: var(--dim);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 10px;
		pointer-events: none;
	}
	.chain-event {
		fill: var(--event);
		font-family: ui-monospace, Menlo, monospace;
		font-size: 10px;
		opacity: 0.7;
		pointer-events: none;
	}
</style>
