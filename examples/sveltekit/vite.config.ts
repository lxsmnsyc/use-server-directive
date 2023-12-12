import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import useServerDirective from 'unplugin-use-server-directive';

export default defineConfig({
  plugins: [
    sveltekit(),
    useServerDirective.vite({
      directive: 'use server',
      mode: 'server',
      filter: {
        include: 'src/**/*.{svelte,ts}',
      },
    }),
  ],
});
