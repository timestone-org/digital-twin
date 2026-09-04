/**
 * @fileoverview 一份原件在页面里画成什么：按后缀查一张显式的表。
 *
 * ⚠ 判据是**后缀**而不是 media type，与后端解析器分派同一条规矩：现场传上来
 * 的文件常常带一个 `application/octet-stream`，而文件名是对的。反过来先信
 * media type 的话，那一批全都画不出来。
 *
 * ⚠ 表里没有的一律给 `none`，**不猜**：猜错的表现是拿错的画法去渲染
 * （把 .pptx 当纯文本摊开是一屏乱码），而如实说「这个格式看不了，下载吧」
 * 至少是一句用户能照着做的话。
 */

/** 一种画法。`none` 是「这个格式没有画法」，界面上退到只给下载。 */
export type PreviewKind =
  'pdf' | 'image' | 'docx' | 'sheet' | 'markdown' | 'html' | 'text' | 'none'

// 后缀 → 画法。⚠ 与后端 `parsing/` 各路后端声明的 `suffixes` 同源：
// 那边收得进来、这边查不到的后缀会一路掉进「只给下载」，而两边单看都对
const BY_SUFFIX: Readonly<Record<string, PreviewKind>> = {
  '.pdf': 'pdf',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.docx': 'docx',
  '.xlsx': 'sheet',
  '.xlsm': 'sheet',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.log': 'text',
  '.json': 'text',
  '.html': 'html',
  '.htm': 'html',
}

// ⚠ `.pptx` 有意不在表里：能忠实画出版式的 pptx 渲染库要么许可证不合规、
// 要么把 echarts 与 lodash 一起拖进来，而画不忠实的版式比不画更误导人

/**
 * 从文件名取小写后缀；取不出给空串。
 * @param filename 文件名
 */
export function suffixOf(filename: string): string {
  const at = filename.lastIndexOf('.')
  if (at < 0) return ''
  return filename.slice(at).toLowerCase()
}

/**
 * 这份原件该用哪种画法。
 * @param filename 原件的文件名（文档行上的标题）
 */
export function previewKindOf(filename: string): PreviewKind {
  return BY_SUFFIX[suffixOf(filename)] ?? 'none'
}
