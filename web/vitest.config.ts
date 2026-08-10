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
    // 用例只从各成员的 tests/ 收；src/ 下不许出现测试文件（结构闸会拦）
    include: [
      '{app,packages}/*/tests/**/*.{test,spec}.ts',
      'app/tests/**/*.{test,spec}.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
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
      },
    },
  },
})
