/**
 * @fileoverview 把一份 JSON 存成本地文件。
 * ⚠ 对象 URL 用完必须 revoke：不释放的话这块 Blob 会一直挂在文档上，
 * 而工作台是长时间开着的页面，导出几次就攒下几份整包。
 */

/** 文件名里的非法字符，Windows 与 macOS 的并集。 */
const UNSAFE_NAME = /[\\/:*?"<>|]+/g
/** 首尾的下划线与空白，替换之后剩下的边角料。 */
const EDGE_FILLER = /^[_\s]+|[_\s]+$/g

/**
 * 名字规整成文件名；整串都被滤掉时给一个兜底名。
 * @param name 原始名字
 */
export function toFileName(name: string): string {
  const safe = name.replace(UNSAFE_NAME, '_').replace(EDGE_FILLER, '')
  return safe === '' ? 'dashboard' : safe
}

/**
 * 触发浏览器下载一份 JSON。
 * @param data 要写进文件的数据
 * @param name 文件名（不含扩展名），会先做字符规整
 */
export function downloadJson(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${toFileName(name)}.json`
  anchor.click()
  URL.revokeObjectURL(href)
}
