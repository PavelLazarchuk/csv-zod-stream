import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        typecheck: {
            enabled: true,
            include: ['test/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
        },
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts'],
            reporter: ['text', 'html'],
            thresholds: {
                lines: 90,
                statements: 90,
                functions: 90,
                branches: 90,
            },
        },
    },
});
