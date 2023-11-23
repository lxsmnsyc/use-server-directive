import { compile, Options } from 'use-server-directive/compiler';
import { createUnplugin } from 'unplugin';
import { createFilter, FilterPattern } from '@rollup/pluginutils';

export interface UseServerDirectivePluginFilter {
  include?: FilterPattern;
  exclude?: FilterPattern;
}

export interface UseServerDirectivePluginOptions extends Options {
  filter?: UseServerDirectivePluginFilter;
}

const DEFAULT_INCLUDE = 'src/**/*.{jsx,tsx,ts,js,mjs,cjs}';
const DEFAULT_EXCLUDE = 'node_modules/**/*.{jsx,tsx,ts,js,mjs,cjs}';

const useServerDirectivePlugin = createUnplugin((options: UseServerDirectivePluginOptions) => {
  const filter = createFilter(
    options.filter?.include || DEFAULT_INCLUDE,
    options.filter?.exclude || DEFAULT_EXCLUDE,
  );

  let env: UseServerDirectivePluginOptions['env'];

  return {
    name: 'use-server-directive',
    vite: {
      enforce: 'pre',
      configResolved(config) {
        env = config.mode !== 'production' ? 'development' : 'production';
      },
      async transform(code, id, opts) {
        if (filter(id)) {
          const result = await compile(id, code, {
            ...options,
            mode: opts?.ssr ? 'server' : 'client',
            env,
          });
          return {
            code: result.code || '',
            map: result.map,
          }
        }
        return undefined;
      }
    },
    transformInclude(id) {
      return filter(id);
    },
    async transform(code, id) {
      const result = await compile(id, code, options);
      return {
        code: result.code || '',
        map: result.map,
      }
    },
  };
});

export default useServerDirectivePlugin;
