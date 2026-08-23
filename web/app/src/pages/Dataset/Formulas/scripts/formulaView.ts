/**
 * @fileoverview 公式库列表的纯展示逻辑：分类文案、本地搜索、按分类分组，
 * 以及引用反查那张表要的行形状。
 *
 * ⚠ 分类只是一个自由字符串（后端 `category`，上限 32），没有目录端点。
 * 故文案表在前端，且**认不出来的分类照原样显示**——藏起来等于让那条公式
 * 从界面上消失，而它在台账列里照样能被调用（docs/DATASET_DESIGN.md §7.13）。
 */

import type {
  DatasetFormulaDef,
  DatasetFormulaUsage,
  DtSelectOption,
} from '@dt/contracts'

/** 出厂预设用到的四个分类 + 自建默认落的那个。 */
export const FORMULA_CATEGORIES: readonly DtSelectOption[] = [
  { value: 'trend', label: '趋势' },
  { value: 'basic', label: '基础' },
  { value: 'energy', label: '能源' },
  { value: 'stat', label: '统计' },
  { value: 'custom', label: '自定义' },
]

/** 新建时落在哪一档。与后端 `DEFAULT_CATEGORY` 同值。 */
export const DEFAULT_CATEGORY = 'custom'

export interface FormulaGroup {
  key: string
  label: string
  items: DatasetFormulaDef[]
}

/** 分类的显示名；表里没有的照原样给。 */
export function categoryLabel(key: string): string {
  return FORMULA_CATEGORIES.find((one) => one.value === key)?.label ?? key
}

/**
 * 下拉里的分类选项。
 * ⚠ 正在编辑的那条若挂着一个表外分类，必须把它补进选项里：不补的话下拉显示
 * 为空，用户随手一存就把那条公式**改**成了另一个分类，而他从没打算改。
 * @param current 当前取值
 */
export function categoryOptions(current: string): DtSelectOption[] {
  const known = FORMULA_CATEGORIES.some((one) => one.value === current)
  return known || current === ''
    ? [...FORMULA_CATEGORIES]
    : [...FORMULA_CATEGORIES, { value: current, label: current }]
}

/** 关键词命中标识、名称、说明或公式体——四处都是人会拿来找它的线索。 */
export function matchesKeyword(
  formula: DatasetFormulaDef,
  keyword: string,
): boolean {
  const word = keyword.trim().toLowerCase()
  if (word === '') return true
  const fields = [
    formula.code,
    formula.name,
    formula.description ?? '',
    formula.expression,
  ]
  return fields.some((field) => field.toLowerCase().includes(word))
}

/**
 * 按分类分组，组内按名称排。
 * ⚠ 排序钉 `zh-CN`：自托管 runner 是中文 locale、开发机是 en-US，不钉的话
 * 同一份数据在两处的顺序不同，本地绿、CI 红。
 * @param items 全部库公式
 * @param keyword 搜索词，空串即不筛
 */
export function groupFormulas(
  items: readonly DatasetFormulaDef[],
  keyword: string,
): FormulaGroup[] {
  const buckets = new Map<string, DatasetFormulaDef[]>()
  for (const formula of items) {
    if (!matchesKeyword(formula, keyword)) continue
    const bucket = buckets.get(formula.category) ?? []
    bucket.push(formula)
    buckets.set(formula.category, bucket)
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({
      key,
      label: categoryLabel(key),
      items: [...list].sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN'),
      ),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

/** 引用反查那张表的一行。`DtDataView` 要 `id`，而后端给的是 `column_id`。 */
export interface FormulaUsageRow extends DatasetFormulaUsage {
  id: string
}

export function usageRows(
  usages: readonly DatasetFormulaUsage[],
): FormulaUsageRow[] {
  return usages.map((usage) => ({ ...usage, id: usage.column_id }))
}

/**
 * 受影响面：几个列、几张表。
 * ⚠ 两个数都要说：一条公式在同一张表里被三列调用时，「3 个列」与「1 张表」
 * 说的是两件事——前者是口径扩散面，后者是要去重算几次。
 * @param usages 引用反查的结果
 */
export function affectedCounts(usages: readonly DatasetFormulaUsage[]): {
  columns: number
  tables: number
} {
  return {
    columns: usages.length,
    tables: new Set(usages.map((usage) => usage.table_id)).size,
  }
}

/**
 * 保存回执：改动扩散到哪、以及历史行什么时候才跟上。
 * ⚠ 只有**口径**变了才提重算：改名与换分类不会让任何历史行过期，那时说
 * 「要重算」是一句假话，跑一遍全表重算是白付的代价（后端 `updated_message`
 * 是同一个判断）。
 * @param usages 回执里带的引用面
 * @param isSemantic 这次改的是公式体或形参
 */
export function savedMessage(
  usages: readonly DatasetFormulaUsage[],
  isSemantic: boolean,
): string {
  const { columns, tables } = affectedCounts(usages)
  if (columns === 0) return '库公式已更新。目前还没有台账列在用它'
  if (!isSemantic) {
    return `库公式已更新。${columns} 个台账列跟着它走，本次改动不影响算出来的数`
  }
  return (
    `库公式已更新。${columns} 个台账列（${tables} 张台账）即刻改按新口径算，` +
    '历史行要等重算之后才跟上'
  )
}
