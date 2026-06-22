import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// SPA mode: detail pages are loaded client-side, so a fallback is served for
			// any route that isn't prerendered. `base` lets the site live in a GH Pages subdir.
			adapter: adapter({ fallback: '404.html' }),
			paths: {
				base: process.argv.includes('dev') ? '' : ((process.env.BASE_PATH ?? '') as '' | `/${string}`)
			}
		})
	]
});
