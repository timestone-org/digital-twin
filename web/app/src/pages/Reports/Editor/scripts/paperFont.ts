/**
 * @fileoverview 编辑器纸面的正文字体：缺省值与 Word 生成器 `PageSettings` 相同，
 * 中文字体名补上 macOS / Windows 的同款回落，避免浏览器退回无衬线体。
 */

export const REPORT_DEFAULT_PAGE = { fontFamily: '宋体', fontSizePt: 12 }

const GENERIC = new Set(['serif', 'sans-serif'])
const FALLBACKS: Record<string, string[]> = {
  宋体: ['SimSun', 'Songti SC', 'STSong', 'serif'],
  黑体: ['SimHei', 'Heiti SC', 'PingFang SC', 'sans-serif'],
  仿宋: ['FangSong', 'STFangsong', 'serif'],
  楷体: ['KaiTi', 'Kaiti SC', 'STKaiti', 'serif'],
  微软雅黑: ['Microsoft YaHei', 'PingFang SC', 'sans-serif'],
}

/**
 * 页面设置里的字体名 → CSS font-family。
 * @param family Word 里写入的字体名
 */
export function paperFontStack(family: string): string {
  const name = family.trim() || REPORT_DEFAULT_PAGE.fontFamily
  const rest = FALLBACKS[name] ?? ['sans-serif']
  return [name, ...rest]
    .map((item) => (GENERIC.has(item) ? item : `"${item}"`))
    .join(', ')
}
