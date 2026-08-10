/**
 * @fileoverview 挂载入口。装配顺序：样式 → pinia → 路由 → 挂载。
 * ⚠ pinia 必须在 router 之前装：守卫里会用到 auth store。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { router } from './router'
// ⚠ 顺序不可换：tailwind.css 里那句 `@layer theme, base, components, utilities`
// 决定了级联层的先后。它必须先出现，后面 index.scss 往 base / components 层里
// 追加的规则才排在 utilities 之前——否则工具类会被全局样式压住。
import './styles/tailwind.css'
import './styles/index.scss'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
