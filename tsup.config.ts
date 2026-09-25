import { defineConfig, type Options } from 'tsup';

const shared: Options = { format: ['esm', 'cjs'], dts: true, sourcemap: false, clean: false, splitting: false };

export default defineConfig([
  {
    ...shared,
    entry: { server: 'src/server/index.ts', relay: 'src/relay/index.ts' },
    platform: 'node',
    target: 'node20',
  },
  {
    ...shared,
    entry: { client: 'src/client/index.ts' },
    platform: 'browser',
    target: 'es2020',
  },
  {
    // The hook runs in Next's app router too, where it must be marked client-only.
    ...shared,
    entry: { react: 'src/client/react.ts' },
    platform: 'browser',
    target: 'es2020',
    external: ['react'],
    banner: { js: "'use client';" },
  },
]);
