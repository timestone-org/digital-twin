import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      // 从 three 原样拷来的第三方产物，改一个字节那条契约测试就红
      'app/public/draco/**',
    ],
  },
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
      // computed 的执行次数不由你决定，任何副作用都是不可控的
      'vue/no-side-effects-in-computed-properties': 'error',
      // 解构 props 会丢失响应性，之后父组件改了它不会变
      'vue/no-setup-props-reactivity-loss': 'error',
      'vue/no-ref-as-operand': 'error',
      'vue/no-template-target-blank': 'error',
      'vue/require-typed-ref': 'error',
      // 压制类型检查要用 @ts-expect-error 且写明为什么这里预期报错
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 6,
        },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
      // 规模上限：超了不是「写得不好」，是这段代码承担了多件事
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: '用 useConfirm().ask()，它塞得下后果说明' },
        { name: 'alert', message: '用 useToast()' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message:
            'enum 会生成运行时代码且与后端字符串枚举对不齐，用 const 联合类型',
        },
        {
          selector:
            "TSAsExpression > TSTypeReference > Identifier[name='unknown']",
          message: 'as unknown as 一律打回：它把两次类型检查一起关掉了',
        },
        {
          // 只拦写入内容：读它是在断言渲染结果，赋空串是在清场，都不是注入点
          selector:
            "AssignmentExpression[left.property.name='innerHTML']:not([right.value=''])",
          message: 'innerHTML 直接赋值是 XSS 落点，用文本节点或统一清洗函数',
        },
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.callee.name='reactive']",
          message: '解构 reactive 会丢响应性；默认用 ref',
        },
      ],
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
    // ⚠ pinia 的 setup store 是**容器**不是函数：它的函数体里装的是状态
    // 与一组动作，按「函数 ≤50 行」量它等于要求把一个 store 拆成好几个，
    // 而那会让「同一份会话状态」散到多处。按类的 300 行上限量整个文件。
    files: ['**/stores/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': ['error', { max: 300, skipBlankLines: true }],
    },
  },
  {
    // 单文件组件 ≤300 行：超了几乎总是因为逻辑写在了组件里，
    // 而逻辑抽进组合式函数才能被独立单元测试
    files: ['**/*.vue'],
    rules: { 'max-lines': ['error', { max: 300, skipBlankLines: true }] },
  },
  {
    // describe/it 的回调天然长；断言里的字面量也不该被当成魔数
    files: ['**/*.{test,spec}.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'max-lines-per-function': 'off',
      // 测 provide/inject 必须有父子两个组件——一个组件 inject 不到自己 provide 的东西
      'vue/one-component-per-file': 'off',
    },
  },
  {
    // ⚠ story 里的组件与 args 在 typescript-eslint 眼里是 any：`.vue` 的模块
    // 只有 vue-tsc 解析得出来（同 `**/*.spec.ts` 那条）。真正的类型检查由
    // `pnpm typecheck` 里的 vue-tsc 做，story 的 args 仍与组件 props 对齐。
    // 展示矩阵的模板串天然长，按「函数 ≤50 行」量它等于要求把一组变体拆散。
    files: ['**/stories/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['*.config.{ts,js}', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: { parserOptions: { project: null } },
    ...tseslint.configs.disableTypeChecked,
  },
)
