import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        project: ['./app/tsconfig.json', './packages/*/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // 关掉类型检查等于关掉这一段的检查，不是「暂时不标」
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // ⚠ 未 await 的 Promise 不会报错，只是错误被静默吞掉、时序变得不可预测
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'vue/no-mutating-props': 'error',
      'vue/require-explicit-emits': 'error',
      'vue/require-v-for-key': 'error',
      // v-html 是 XSS 的主要落点；确需使用的地方逐处放行并配转义用例
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',
      // 排版归 prettier 管，两边都管会互相打架
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      // TS 的 `?:` 已经表达了可选，再要求运行时默认值是重复且会引入假默认值
      'vue/require-default-prop': 'off',
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.{test,spec}.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  {
    files: ['*.config.{ts,js}', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: { parserOptions: { project: null } },
    ...tseslint.configs.disableTypeChecked,
  },
)
