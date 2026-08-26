/**
 * @fileoverview 本包用到的非 TS 资源与跨包 `.vue` 的模块声明。
 */

// ⚠ 这条通配只服务 typescript-eslint 那一趟：它跑的是纯 tsc 程序，解析不了 SFC，
// 没有它，`.vue` 的默认导出在那一趟里是 error 类型。真实的 `.vue` 文件在解析时
// 优先于通配模块，所以 vue-tsc 那一趟照旧按 SFC 的真类型检查。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, unknown, unknown>
  export default component
}

// 构建期把 SVG 原文当字符串内联（sprite 宿主用）。
// ⚠ 不用 `vite/client` 那份全量声明：本包不装 vite，只需要这一种后缀。
declare module '*.svg?raw' {
  const content: string
  export default content
}
