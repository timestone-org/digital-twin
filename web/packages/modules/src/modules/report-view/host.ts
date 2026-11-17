/** @fileoverview 报告展示的宿主注入口，报告请求与权限由应用壳持有。 */
import type { Component } from 'vue'

let host: Component | null = null
/** 安装异步报告宿主；传 null 可清理展示环境。 */
export function configureReportHost(component: Component | null): void {
  host = component
}
/** 读取当前应用安装的报告展示能力。 */
export function reportHost(): Component | null {
  return host
}
