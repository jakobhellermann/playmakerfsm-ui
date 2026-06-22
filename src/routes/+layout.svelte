<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import '../app.css';

	let { children } = $props();

	// content is immutable (content-addressed), so never treat cached data as stale
	const client = new QueryClient({
		defaultOptions: {
			queries: { staleTime: Infinity, gcTime: Infinity, retry: 1 }
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>PlayMaker FSM browser</title>
</svelte:head>

<QueryClientProvider {client}>
	{@render children()}
</QueryClientProvider>
