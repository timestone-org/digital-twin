import { fileURLToPath, URL } from 'node:url'

import tailwind from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue(), tailwind()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app/src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    // ⚠ 默认的 5s 对这套规模（近六千条，大半要 mount 组件）在 CPU 受限的
    // 容器里不够：卡顿时随机哪一条都可能撞上，且每轮撞的是不同的几条——
    // 看着像四处冒出来的 flaky，其实是同一个阈值太紧。超时只是防死循环的
    // 保护上限，不是性能断言；正常用例是毫秒级，永远碰不到 15s。
    testTimeout: 15_000,
    // 用例只从各成员的 tests/ 收；src/ 下不许出现测试文件（结构闸会拦）
    include: [
      '{app,packages}/*/tests/**/*.{test,spec}.ts',
      'app/tests/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      // ⚠ SF 必须仓库根相对：diff-cover 在仓库根拿 SF 与 git diff 比对，
      // 写成 web/ 相对会整份对不上、增量覆盖闸静默空转（#59）
      reporter: [
        'text-summary',
        'html',
        [
          'lcov',
          { projectRoot: fileURLToPath(new URL('..', import.meta.url)) },
        ],
      ],
      reportsDirectory: './coverage',
      include: ['packages/**/src/**/*.{ts,vue}', 'app/src/**/*.{ts,vue}'],
      exclude: [
        '**/tests/**',
        '**/index.ts',
        '**/*.d.ts',
        '**/src/testing/**',
        'app/src/main.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        statements: 80,
        // ⚠ 这一档比行覆盖更能反映「写操作有没有被测到」：v8 把模板里每个内联
        // 事件处理器都算成一个函数，所以它掉下去通常意味着某条交互路径（点查询、
        // 切筛选、弹窗保存、取消）根本没人点过——不是口径问题，是真没测。
        functions: 85,
        // 核心逻辑包（绑定、求值、坐标、协议、状态机）单独抬高到 95/90；
        // 组件（.vue）不在这一档，走 85/75 的组件线
        'packages/*/src/**/*.ts': { lines: 95, branches: 90 },
      },
    },
  },
})
