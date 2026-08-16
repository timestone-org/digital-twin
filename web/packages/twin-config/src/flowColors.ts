/**
 * @fileoverview 能量流的种类配色：种类名 → 颜色规格（`--token` 或 `#rrggbb`）。
 *
 * ⚠ 渲染层与图例必须走同一份：图例上的色块与画面上的管线对不上，比没有图例更糟——
 * 用户会照着图例去认颜色，而那份对照是错的。
 */

/** 没配种类、或种类不认识时的缺省色。 */
export const FLOW_COLOR_FALLBACK = '#00cefc'

/** 各能源种类的内置配色；主题里配了 `--flow-<kind>` 时以主题为准。 */
export const FLOW_KIND_COLORS: Readonly<Record<string, string>> = {
  water: '#4cc9ff',
  steam: '#dde5f2',
  electricity: '#ffd166',
  power: '#ffd166',
  gas: '#f78c6b',
  oil: '#c9a227',
  heat: '#ff6b6b',
  cold: '#8ecae6',
  air: '#8fe3a5',
}

/** 只有这个形状的种类名才拿去拼 CSS 变量名。 */
const KIND_TOKEN_RE = /^[a-z0-9-]+$/

/**
 * 种类名 → 主题 token 名；名字里有别的字符时给 null（拼出来的变量名不合法）。
 * @param kind 能源种类
 */
export function flowKindToken(kind: string): string | null {
  const key = kind.trim().toLowerCase()
  return KIND_TOKEN_RE.test(key) ? `--flow-${key}` : null
}

/**
 * 种类名 → 内置配色；不认识的种类给缺省色。
 * ⚠ 这是 token 取不出时的兜底，不是取色的第一顺位——主题里配了 `--flow-<kind>`
 * 的话以主题为准，两边的优先级由渲染层与图例各自照此实现。
 * @param kind 能源种类
 */
export function flowKindColor(kind: string): string {
  return FLOW_KIND_COLORS[kind.trim().toLowerCase()] ?? FLOW_COLOR_FALLBACK
}
