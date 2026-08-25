/**
 * @fileoverview 挂载入口。装配顺序：样式 → pinia → 路由 → 挂载。
 * ⚠ pinia 必须在 router 之前装：守卫里会用到 auth store。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { installAiAssistant } from './bootstrap/ai'
import { router } from './router'
// ⚠ 顺序不可换：tailwind.css 里那句 `@layer theme, base, components, utilities`
// 决定了级联层的先后。它必须先出现，后面 index.scss 往 base / components 层里
// 追加的规则才排在 utilities 之前——否则工具类会被全局样式压住。
import './styles/tailwind.css'
import './styles/index.scss'
// ⚠ 单独一条：装饰位图的 url() 只有走纯 CSS 才会被构建重写成带 hash 的产物路径，
// 并进 index.scss 会被 Sass 内联掉、产物里留一条死路径（见该文件头）
import '@dt/tokens/decor.scss'

// ⚠ **删掉这一行 = 整个 AI 子系统不存在**：入口不出现、代码不进首屏包。
// 某些现场没有外网、根本不部署 ai-assistant，那时这里就是唯一要改的地方
// （见 features/ai/ports.ts 记的三层「关掉」）。
installAiAssistant()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
