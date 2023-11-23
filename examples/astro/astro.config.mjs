import { defineConfig } from 'astro/config';

import solidJs from "@astrojs/solid-js";
import tailwind from "@astrojs/tailwind";
import node from '@astrojs/node';
import useServerDirective from 'unplugin-use-server-directive';

// https://astro.build/config
export default defineConfig({
  integrations: [solidJs(), tailwind()],
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  vite: {
    plugins: [
      useServerDirective.vite({
        directive: 'use server',
        mode: 'server',
      }),
    ],
  },
});
