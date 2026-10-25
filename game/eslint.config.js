import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SIM_PURITY_MESSAGE = 'sim/ must be deterministic and DOM-free: use the injected Rng and dt instead';

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
    files: ['src/sim/**/*.ts'],
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
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
