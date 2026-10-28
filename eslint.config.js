// MIT License © 2026 Carlos Lopez
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Files copied from nymph keep their upstream style; they are covered by tests.
  {
    ignores: [
      'node_modules/',
      'build/',
      'dist/',
      'packages/collab-session/collab-session.js',
      'packages/collab-whiteboard/collab-whiteboard.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
