// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'storage/**', 'eslint.config.mjs', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { parserOptions: { project: false } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // NOTE: constructor-injected classes must be VALUE imports (never `import type`) or Nest's DI metadata breaks;
      // the e2e tests boot the real app, so a mistake there fails immediately.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // seed + tests may print and use looser typing around mocks
    files: ['prisma/seed.ts', 'test/**/*.ts', 'src/**/*.spec.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
