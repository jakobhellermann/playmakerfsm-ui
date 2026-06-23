<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		GAMES,
		DEFAULT_GAME,
		fetchIndex,
		fetchSceneNames,
		isGame,
		sceneLabel,
		type Game
	} from '$lib/data';
	import { groupNamedScenes, groupOtherFiles, type SceneGroup } from '$lib/scenes';
	import { isGroupOpen, setGroupOpen } from '$lib/openGroups';

	const game = $derived<Game>(
		isGame(page.params.game ?? null) ? (page.params.game as Game) : DEFAULT_GAME
	);
	const query = $derived(page.url.searchParams.get('q') ?? '');

	// debounced query for filtering — lets the input render the typed char before the heavy
	// scene computation runs. The URL updates immediately (for links/navigation); the filter
	// waits a tick.
	let debouncedQuery = $state('');
	$effect(() => {
		const q = query;
		const id = setTimeout(() => (debouncedQuery = q), 0);
		return () => clearTimeout(id);
	});

	const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

	const indexQuery = createQuery(() => ({
		queryKey: ['index', game],
		queryFn: () => fetchIndex(game)
	}));
	const entries = $derived(indexQuery.data ?? []);

	const sceneNamesQuery = createQuery(() => ({
		queryKey: ['sceneNames', game],
		queryFn: () => fetchSceneNames(game)
	}));
	const sceneNames = $derived(sceneNamesQuery.data ?? new Map<string, string>());

	const match = (s: string) => s.toLowerCase().includes(debouncedQuery.trim().toLowerCase());
	const byFile = (a: { file: string }, b: { file: string }) => coll.compare(a.file, b.file);
	const sceneHref = (s: SceneRow) =>
		`${base}/${game}/${encodeURIComponent(s.file)}${s.contentMatch ? `?q=${encodeURIComponent(debouncedQuery.trim())}` : ''}`;

	type SceneRow = {
		file: string;
		name: string;
		count: number;
		named: boolean;
		contentMatch: boolean;
	};
	const scenes = $derived.by(() => {
		const q = debouncedQuery.trim().toLowerCase();
		const by = new Map<string, number>();
		const searchText = new Map<string, string>();
		for (const e of entries) {
			by.set(e.file, (by.get(e.file) ?? 0) + 1);
			if (q) {
				const s = (e.name + ' ' + e.game_object).toLowerCase();
				searchText.set(e.file, (searchText.get(e.file) ?? '') + ' ' + s);
			}
		}
		const rows: SceneRow[] = [...by.entries()].map(([file, count]) => {
			const named = sceneNames.has(file);
			const contentMatch = q.length > 0 && (searchText.get(file) ?? '').includes(q);
			return {
				file,
				count,
				named,
				contentMatch,
				name: named ? sceneNames.get(file)! : sceneLabel(file)
			};
		});
		return rows.filter((s) => match(s.name) || match(s.file) || s.contentMatch).sort(byFile);
	});
	const namedScenes = $derived(scenes.filter((s) => s.named));
	const otherScenes = $derived(scenes.filter((s) => !s.named));

	// ungrouped singles first, then the collapsible prefix groups
	const singlesFirst = (gs: SceneGroup<SceneRow>[]) => [
		...gs.filter((g) => !g.group),
		...gs.filter((g) => g.group)
	];
	const namedGroups = $derived(singlesFirst(groupNamedScenes(namedScenes)));
	const otherGroups = $derived(singlesFirst(groupOtherFiles(otherScenes)));
</script>

{#snippet groupList(groups: SceneGroup<SceneRow>[], ns: string)}
	<ul class="grouplist">
		{#each groups as g (g.prefix)}
			{@const key = `${game}:${ns}:${g.prefix}`}
			<li>
				{#if g.group}
					<details
						open={isGroupOpen(key) || debouncedQuery !== ''}
						ontoggle={(e) => {
							if (!debouncedQuery) setGroupOpen(key, e.currentTarget.open);
						}}
					>
						<summary>{g.prefix} <span class="dim badge">{g.items.length}</span></summary>
						<ul class="sublist">
							{#each g.items as s (s.file)}
								<li>
									<a class="rowlink" href={sceneHref(s)} title={s.file}>{s.name}</a>
									<span class="dim badge">{s.count}</span>
								</li>
							{/each}
						</ul>
					</details>
				{:else}
					{@const s = g.items[0]}
					<span class="single">
						<a class="rowlink" href={sceneHref(s)} title={s.file}>{s.name}</a>
						<span class="dim badge">{s.count}</span>
					</span>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if indexQuery.isPending}
	<p class="msg dim">loading…</p>
{:else if indexQuery.isError}
	<p class="msg err">{String(indexQuery.error)}</p>
{:else}
	<div class="cols">
		<section class="col">
			<div class="count dim">{namedScenes.length} scenes</div>
			{@render groupList(namedGroups, 'named')}
		</section>
		{#if otherScenes.length}
			<section class="col">
				<div class="count dim">{otherScenes.length} other files</div>
				{@render groupList(otherGroups, 'other')}
			</section>
		{/if}
	</div>
{/if}

<style>
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1rem;
		align-items: flex-start;
	}
	.col {
		flex: 1 1 320px;
		min-width: 0;
	}
	.count {
		padding: 0.6rem 1.25rem 0;
		font-size: 0.85rem;
	}
	.grouplist {
		list-style: none;
		margin: 0;
		padding: 0.4rem 1.25rem 2rem;
	}
	.grouplist > li {
		padding: 0.08rem 0;
	}
	.grouplist summary {
		cursor: pointer;
		font-weight: 600;
		padding: 0.06rem 0;
	}
	.single {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}
	.sublist {
		list-style: none;
		margin: 0;
		padding-left: 0.8rem;
		border-left: 1px solid #2a2a2a;
	}
	.sublist li {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.05rem 0;
		min-width: 0;
	}
	.rowlink {
		color: var(--accent);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rowlink:hover {
		text-decoration: underline;
	}
	.badge {
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	.msg {
		padding: 1rem 1.25rem;
	}
	.err {
		color: #e06c75;
	}
</style>
