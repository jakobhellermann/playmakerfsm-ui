<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		DEFAULT_GAME,
		fetchIndex,
		fsmSegments,
		goLeaf,
		isGame,
		resolveFsm,
		type Game
	} from '$lib/data';
	import type { IndexEntry } from '$lib/model';
	import FsmDetail from '$lib/views/FsmDetail.svelte';

	const game = $derived<Game>(
		isGame(page.params.game ?? null) ? (page.params.game as Game) : DEFAULT_GAME
	);
	const scene = $derived(page.params.scene ?? '');
	const rest = $derived(page.params.rest ? page.params.rest.split('/') : []);
	const query = $derived(page.url.searchParams.get('q') ?? '');

	const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	const byName = <T extends { name: string }>(a: T, b: T) => coll.compare(a.name, b.name);

	const indexQuery = createQuery(() => ({
		queryKey: ['index', game],
		queryFn: () => fetchIndex(game)
	}));
	const entries = $derived(indexQuery.data ?? []);

	// rest is empty on the object tree, [...gameObject, fsm] on a detail
	const detailEntry = $derived(rest.length ? resolveFsm(entries, scene, rest) : undefined);

	const match = (s: string) => s.toLowerCase().includes(query.trim().toLowerCase());
	const fsmHref = (e: IndexEntry) =>
		`${base}/${game}/${fsmSegments(entries, e).map(encodeURIComponent).join('/')}`;

	type TreeNode = { name: string; children: Map<string, TreeNode>; fsms: IndexEntry[] };
	const newNode = (name: string): TreeNode => ({ name, children: new Map(), fsms: [] });

	const tree = $derived.by(() => {
		const root = newNode('');
		for (const e of entries) {
			if (e.file !== scene) continue;
			if (query && !(match(e.name) || match(e.game_object))) continue;
			const segs = e.game_object === '' ? [] : e.game_object.split('/');
			let node = root;
			for (const seg of segs) {
				let child = node.children.get(seg);
				if (!child) node.children.set(seg, (child = newNode(seg)));
				node = child;
			}
			node.fsms.push(e);
		}
		return root;
	});

	function countFsms(n: TreeNode): number {
		let c = n.fsms.length;
		for (const child of n.children.values()) c += countFsms(child);
		return c;
	}
	const sortedChildren = (n: TreeNode) => [...n.children.values()].sort(byName);
	const sortedFsms = (n: TreeNode) => [...n.fsms].sort(byName);
	const sceneCount = $derived(countFsms(tree));
</script>

{#snippet fsmLeaves(node: TreeNode)}
	{#if node.fsms.length}
		<ul class="fsms">
			{#each sortedFsms(node) as f (f.path_id)}
				<li>
					<a href={fsmHref(f)}>{f.name}</a>{#if f.name === 'Control'}<span
							class="star"
							title="main Control FSM">★</span
						>{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet treeNodes(node: TreeNode)}
	<ul class="tree">
		{#each sortedChildren(node) as child (child.name)}
			<li>
				{#if child.children.size}
					<details open>
						<summary>
							<span class="obj">{child.name}</span>
							<span class="dim badge">{countFsms(child)}</span>
						</summary>
						{@render fsmLeaves(child)}
						{@render treeNodes(child)}
					</details>
				{:else}
					<div class="objrow"><span class="obj">{child.name}</span></div>
					{@render fsmLeaves(child)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if rest.length}
	{#if detailEntry}
		<FsmDetail {game} hash={detailEntry.hash} />
	{:else if indexQuery.isPending}
		<p class="msg dim">loading…</p>
	{:else}
		<p class="msg err">no FSM at this path</p>
	{/if}
{:else if indexQuery.isPending}
	<p class="msg dim">loading…</p>
{:else if indexQuery.isError}
	<p class="msg err">{String(indexQuery.error)}</p>
{:else}
	<div class="count dim">{sceneCount} FSMs</div>
	<div class="treewrap">
		{#if tree.fsms.length}
			<div class="objrow"><span class="obj dim">{goLeaf('')}</span></div>
			{@render fsmLeaves(tree)}
		{/if}
		{@render treeNodes(tree)}
	</div>
{/if}

<style>
	.count {
		padding: 0.6rem 1.25rem 0;
		font-size: 0.9rem;
	}
	.treewrap {
		padding: 0.4rem 1.25rem 2rem;
	}
	.tree {
		list-style: none;
		margin: 0;
		padding-left: 1.1rem;
		border-left: 1px solid #2a2a2a;
	}
	.treewrap > .tree {
		padding-left: 0;
		border-left: none;
	}
	details > summary {
		cursor: pointer;
		padding: 0.1rem 0;
	}
	.obj {
		color: var(--fg);
	}
	.objrow {
		padding: 0.1rem 0;
	}
	.fsms {
		list-style: none;
		margin: 0;
		padding-left: 1.1rem;
	}
	.fsms li {
		padding: 0.05rem 0;
	}
	.fsms a {
		color: var(--accent);
		text-decoration: none;
	}
	.fsms a:hover {
		text-decoration: underline;
	}
	.star {
		color: var(--event);
		font-size: 0.8rem;
		margin-left: 0.3rem;
	}
	.badge {
		font-size: 0.8rem;
		flex-shrink: 0;
	}
	.msg {
		padding: 1rem 1.25rem;
	}
	.err {
		color: #e06c75;
	}
</style>
