/**
 * @fileoverview 节点样式分栏的显示名：调色板与节点检查器的样式下拉共用这一份。
 * ⚠ `category` 只用于分栏显示，不参与任何渲染判断（docs/MODULE_TWIN_2D_DESIGN.md §7 #55）。
 */

/** 预置库那几个分栏的显示名；认不出的原样显示，用户自建的分栏照样成栏。 */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  source: '热源',
  vessel: '容器',
  terminal: '末端',
  exchanger: '换热',
  label: '文字',
  circuit: '电路符号',
}

/** 没分栏的样式归到的那一栏。 */
const UNCATEGORIZED = '未分类'

/**
 * 一个分栏的显示名。
 * @param category 样式上的分栏名
 */
export function twin2dCategoryLabel(category: string): string {
  if (category === '') return UNCATEGORIZED
  return CATEGORY_LABELS[category] ?? category
}
