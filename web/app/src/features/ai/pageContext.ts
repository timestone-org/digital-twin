/** @fileoverview 助手页面定位只使用 pathname，查询参数和片段不进入模型。 */
export function currentPagePath(): string {
  return window.location.pathname
}
