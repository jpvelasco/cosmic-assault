import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SIM_PURITY_MESSAGE = 'sim/, content/, meta/ and bot/ must be deterministic and DOM-free: use the injected Rng and dt instead';

export default defineConfig(
  { ignores: ['dist', 'dist-e2e', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/sim/**/*.ts', 'src/content/**/*.ts', 'src/meta/**/*.ts', 'src/bot/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'performance',
          'requestAnimationFrame',
          'Date',
          'globalThis',
          'self',
          'setTimeout',
          'setInterval',
        ].map((name) => ({
          name,
          message: SIM_PURITY_MESSAGE,
        })),
      ],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: SIM_PURITY_MESSAGE }],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          "MemberExpression[property.name='shadowBlur']",
          "MemberExpression[property.value='shadowBlur']",
          "Property[key.name='shadowBlur']",
        ].map((selector) => ({
          selector,
          message: 'Bake glow into sprites instead of setting shadowBlur per frame',
        })),
      ],
    },
  },
  {
    files: ['src/content/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/sim/**', '**/render/**', '**/ui/**', '**/app/**', '**/audio/**', '**/input/**', '**/platform/**'],
              message: 'content/ is plain data that sim/ builds on: move shared rules into content/ instead of importing sim/ or any DOM folder',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/bot/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/ui/**', '**/app/**', '**/audio/**', '**/input/**', '**/platform/**'],
              message: 'Bots play headless: they read the sim and content and answer with Controls, so move what they need out of the DOM folders',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/sw/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/ui/**', '**/app/**', '**/audio/**', '**/input/**'],
              message: "The service worker runs without a DOM, so it may not import the app's DOM folders; tsc -p src/sw checks everything else it imports",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
