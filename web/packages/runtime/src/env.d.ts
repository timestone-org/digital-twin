// ⚠ 这份通配声明只服务不带 vue 插件的那趟检查（typescript-eslint 用的是纯 tsc
// 程序，解析不了 `.vue`，跨包引来的组件在它眼里是 error 类型）。真实的 `.vue`
// 文件在解析时优先于通配模块，`vue-tsc` 那一趟仍按 SFC 的真类型检查。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, unknown, unknown>
  export default component
}
