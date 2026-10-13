import tseslint from 'typescript-eslint';

const correctnessRules = {
  'no-constant-binary-expression': 'error',
  'no-debugger': 'error',
  'no-duplicate-imports': 'error',
  'no-unreachable-loop': 'error',
  'no-unsafe-finally': 'error',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite/**',
      'supabase/.temp/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: correctnessRules,
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...correctnessRules,
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-constraint': 'error',
    },
  },
];
