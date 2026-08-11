import { fileURLToPath, URL } from 'node:url'

import tailwind from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 开发期把 /api 代到边缘网关；生产由 nginx 同域反代，前端不配绝对地址。
 *
 * ⚠ 默认指向边缘（compose 的 8080）而不是某个服务端口：platform-server 认的是
 * 边缘注入的签名身份头，直连它的端口一律 401；而 auth 与 platform 分属两个前缀，
 * 只有边缘知道该把哪个前缀转给谁。
 */
const DEV_API_TARGET =
  process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [vue(), tailwind()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: DEV_API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
