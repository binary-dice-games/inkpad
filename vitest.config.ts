// MIT License © 2026 Carlos Lopez
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          environment: 'node',
          testTimeout: 15000,
          hookTimeout: 30000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60000,
          // Starting a browser (and, in parallel with other suites, the machine) can take
          // well over vitest's default 10 s on a CI runner.
          hookTimeout: 120000,
        },
      },
    ],
  },
});
