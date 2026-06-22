<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	// no game in the path → land on the default game's scene list
	onMount(() => goto(`${base}/hk`, { replaceState: true }));
</script>
