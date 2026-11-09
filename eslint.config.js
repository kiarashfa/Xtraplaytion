import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const gitignore = fileURLToPath(new URL('.gitignore', import.meta.url));

// Transcendental Math functions differ between JS engines. Deterministic code
// (packages/*) must use @xtraplaytion/dmath instead. Exactly specified ones
// (sqrt, abs, floor, ceil, round, trunc, sign, min, max, fround, imul, clz32) stay allowed.
const nonDeterministicMath = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'cbrt',
  'hypot',
  'random',
].map((property) => ({
  object: 'Math',
  property,
  message: 'Not bit-identical across browsers. Use @xtraplaytion/dmath.',
}));

export default defineConfig(
  includeIgnoreFile(gitignore),
  js.configs.recommended,
  tseslint.configs.strict,
  svelte.configs.recommended,
  astro.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
  },
  {
    files: ['packages/**/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nonDeterministicMath],
    },
  },
  {
    // fdlibm's constants are kept in their published 21-digit spelling; tests prove each
    // rounds to the intended double (bit-identical results against V8).
    files: ['packages/dmath/src/**/*.ts'],
    rules: { 'no-loss-of-precision': 'off' },
  },
);
