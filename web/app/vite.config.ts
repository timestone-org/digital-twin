import { fileURLToPath, URL } from 'node:url'

import tailwind from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/** 开发期把 /api 代到边缘网关；生产由 nginx 同域反代，前端不配绝对地址。 */
const DEV_API_TARGET =
  process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8004'

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
