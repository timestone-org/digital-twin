/**
 * @fileoverview 把一份数据或一个同源地址存成本地文件（JSON / CSV / 原件）。
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
 * @param fallback 整串都被滤掉时用的名字
 */
export function toFileName(name: string, fallback = 'dashboard'): string {
  const safe = name.replace(UNSAFE_NAME, '_').replace(EDGE_FILLER, '')
  return safe === '' ? fallback : safe
}

/**
 * 触发浏览器下载一份 JSON。
 * @param data 要写进文件的数据
 * @param name 文件名（不含扩展名），会先做字符规整
 */
export function downloadJson(data: unknown, name: string): void {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `${toFileName(name)}.json`,
  )
}

/**
 * 触发浏览器下载一段已经排好版的 JSON 文本。
 * ⚠ 与 `downloadJson` 的分工是「谁排的版」：调用方自己有一套排版口径（样式包的
 * `twin2dStylePackageText`）时走这一支，让「导出的字节」与「导入认得的字节」逐字
 * 同源——在这里再 `JSON.stringify` 一遍就是第二套排版，而往返不一致看不出来。
 * @param text 要写进文件的 JSON 正文
 * @param name 文件名（不含扩展名），会先做字符规整
 */
export function downloadText(text: string, name: string): void {
  downloadBlob(
    new Blob([text], { type: 'application/json' }),
    `${toFileName(name)}.json`,
  )
}

/**
 * 触发浏览器下载一份 CSV。
 * ⚠ MIME 带 `charset=utf-8`，且正文自带 BOM（见 `pointCsv.ts`）：两者缺一，
 * Excel 会按本地代码页解，中文列全是乱码。
 * @param text CSV 正文
 * @param name 文件名（不含扩展名），会先做字符规整
 */
export function downloadCsv(text: string, name: string): void {
  downloadBlob(
    new Blob([text], { type: 'text/csv;charset=utf-8' }),
    `${toFileName(name)}.csv`,
  )
}

/**
 * 触发浏览器下载一份**已经拿到手**的字节。
 *
 * ⚠ 扩展名由调用方连在名字里一起给，这里不补也不改：扩展名是操作系统挑打开
 * 方式的唯一依据，丢掉它的表现是存下来一个双击打不开的文件。
 * ⚠ 与 `downloadUrl` 的分工是「字节在谁手上」：要认人的接口取回来的 Blob 只能
 * 走这一支——把那条地址交给 `<a download>` 的话，浏览器发的是一个不带
 * `Authorization` 的请求，存下来的是一份 401 的错误信封。
 * @param blob 字节
 * @param fileName 存成的文件名，含扩展名；会先做字符规整
 */
export function downloadBytes(blob: Blob, fileName: string): void {
  downloadBlob(blob, toFileName(fileName, '原件'))
}

function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(href)
}

/**
 * 触发浏览器下载一个**同源**地址上的文件。
 * ⚠ 只对同源地址有效：`download` 属性遇到跨源地址会被浏览器整个忽略，表现是
 * 「点了下载却在新标签里打开了一张图」。素材走边缘反代的 `/oss/`，同源成立。
 * @param href 文件地址
 * @param fileName 存成的文件名，会先做字符规整
 */
export function downloadUrl(href: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = toFileName(fileName)
  anchor.click()
}
