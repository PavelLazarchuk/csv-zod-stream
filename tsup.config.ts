import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/web/index.ts'],
    format: ['esm', 'cjs'],
    target: 'node20',
    dts: true,
    clean: true,
    treeshake: true,
    external: ['csv-parse', 'zod'],
});
