import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config';

export default mergeConfig(
    base,
    defineConfig({
        test: {
            exclude: ['test/zod-mini.test.ts'],
            typecheck: { tsconfig: './tsconfig.zod3.json' },
        },
    })
);
