import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/app/e2e-hooks.ts',
        'src/vendor/**',
        '**/*.d.ts'
      ],
      thresholds: {
        lines: 76,
        functions: 82,
        branches: 76,
        statements: 76
      }
    }
  }
});
