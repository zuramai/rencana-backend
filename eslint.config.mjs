// @ts-check
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'src/db/migrations'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({ quotes: 'single', semi: false, commaDangle: 'never', braceStyle: '1tbs', indent: 2 }),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Not part of the web repo's (Nuxt) stylistic preset; dense one-line objects are used throughout.
      '@stylistic/list-style': 'off'
    }
  }
)
