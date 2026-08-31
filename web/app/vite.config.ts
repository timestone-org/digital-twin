import { fileURLToPath, URL } from 'node:url'

import tailwind from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

/**
 * 开发期把 /api 与 /oss 代到边缘网关；生产由 nginx 同域反代，前端不配绝对地址。
 *
 * ⚠ 默认指向边缘（compose 的 8080）而不是某个服务端口：platform-server 认的是
 * 边缘注入的签名身份头，直连它的端口一律 401；而 auth 与 platform 分属两个前缀，
 * 只有边缘知道该把哪个前缀转给谁。
 * ⚠ /oss 也必须代：素材是直传直取的同源地址（ASSET_BASE_URL），少了这条规则，
 * 开发期上传与模型加载一律落到 vite 自己身上，得到的是 index.html 而不是 404，
 * 于是错误发生在解析 GLB 的地方，看着像素材坏了。
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
      // ⚠ `ws` 不能省：少了它 vite 只代普通请求，`/api/v1/realtime/ws` 的
      // Upgrade 根本不会转给边缘——它落到 vite 自己那条只认 `vite-hmr` 的
      // 升级处理上，被静默丢掉。表现是开发期握手永远不完成、全部实时推送
      // （大屏 / 采集配置页 / OPC UA 节点值）一起没有值，而 HTTP 面完全正常。
      '/api': { target: DEV_API_TARGET, changeOrigin: true, ws: true },
      '/oss': { target: DEV_API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // ⚠ 抬过 rollup 那条 500 kB 的泛用提醒，不是放宽预算：真正的预算是
    // `scripts/gates/check_bundle_budget.py` 判的**首屏 gzip**（JS 300 KB /
    // CSS 100 KB），而这条提醒量的是任意分片压缩前的体积——唯一超它的是
    // 懒加载的 three 那一块，首屏根本不下载。留着它只会让构建日志天天黄一行。
    chunkSizeWarningLimit: 800,
  },
})
