/**
 * @fileoverview 列配置表里那几格的取值口径：来源徽标、聚合口径的人话、
 * 以及「来源详情」那一格摊出来的三段。
 *
 * ⚠ 这里只管文案，不管清单：可选项一律从 `@dt/contracts` 的常量数组铺开。
 * 缺一条文案只会退化成显示原始代码，而写死一份清单会让后端新加的那一档
 * 在界面上整个消失（docs/DATASET_DESIGN.md §7.13）。
 */

import {
  DATASET_AGG_FUNCS,
  DATASET_COLUMN_SOURCES,
  DATASET_COLUMN_TYPES,
} from '@dt/contracts'
import type {
  DatasetAggFunc,
  DatasetColumn,
  DatasetColumnSource,
  DatasetColumnType,
  DtIntent,
  DtSelectOption,
} from '@dt/contracts'

/** 来源那一格：一枚徽标加一句解释。 */
export interface ColumnSourceMeta {
  label: string
  intent: DtIntent
  hint: string
}

const SOURCE_META: Record<DatasetColumnSource, ColumnSourceMeta> = {
  manual: {
    label: '人工录入',
    intent: 'neutral',
    hint: '由人在录入表单里填写。',
  },
  point: {
    label: '点位汇总',
    intent: 'primary',
    hint: '绑一个点位，按台账周期从点位历史汇总出一个数。',
  },
  formula: {
    label: '公式计算',
    intent: 'success',
    hint: '由公式算出，不接受手工填写。',
  },
}

/**
 * 来源的标签与说明。
 * ⚠ 认不出的来源原样显示，绝不隐藏：后端加了一档而前端还没跟上时，
 * 「显示成空白」会被读成「这一列没配来源」。
 * @param source 列来源
 */
export function sourceMeta(source: string): ColumnSourceMeta {
  const known = DATASET_COLUMN_SOURCES.find((one) => one === source)
  if (known !== undefined) return SOURCE_META[known]
  return {
    label: source,
    intent: 'warning',
    hint: '这个来源本界面还不认识，按后端的取值原样显示。',
  }
}

/** 聚合口径：短标签给徽标，长说明给下拉与悬停。 */
export interface AggMeta {
  label: string
  desc: string
}

const AGG_META: Record<DatasetAggFunc, AggMeta> = {
  avg: {
    label: '平均值',
    desc: '周期内所有样本的算术平均，适合温度、压力这类连续量。',
  },
  min: { label: '最小值', desc: '周期内的最小样本值。' },
  max: { label: '最大值', desc: '周期内的最大样本值。' },
  last: {
    label: '末值',
    desc: '周期内最后一个样本值，适合水位、料位这类状态量。',
  },
  first: { label: '首值', desc: '周期内第一个样本值。' },
  sum: {
    label: '求和',
    desc: '周期内所有样本值相加。⚠ 电表、水表这类累计读数相加没有意义，那种要用「增量」。',
  },
  count: {
    label: '样本数',
    desc: '周期内采到多少条样本。它本身就是个条数，可用来体检采集稳不稳。',
  },
  delta: {
    label: '增量',
    desc: '本周期末值减上一周期末值，适合累计量表。⚠ 跨周期取数，第一个周期没有上一桶因而为空。',
  },
}

/**
 * 某个聚合口径的说法。
 * ⚠ 认不出的口径退化成「原始代码 + 一句通用说明」，**绝不隐藏这个选项**：
 * 后端可能先于前端上线一档新口径（设计 §7.13）。
 * @param agg 口径代码
 */
export function aggMeta(agg: string): AggMeta {
  const known = DATASET_AGG_FUNCS.find((one) => one === agg)
  if (known !== undefined) return AGG_META[known]
  return { label: agg, desc: '后端新增的取数口径，界面暂无说明。' }
}

const TYPE_LABELS: Record<DatasetColumnType, string> = {
  number: '数值',
  string: '文本',
  bool: '布尔',
}

/**
 * 数据类型的人话。同样认不出就原样显示。
 * @param dataType 列的数据类型
 */
export function typeLabel(dataType: string): string {
  const known = DATASET_COLUMN_TYPES.find((one) => one === dataType)
  return known === undefined ? dataType : TYPE_LABELS[known]
}

export const SOURCE_OPTIONS: readonly DtSelectOption[] =
  DATASET_COLUMN_SOURCES.map((source) => ({
    value: source,
    label: sourceMeta(source).label,
  }))

export const TYPE_OPTIONS: readonly DtSelectOption[] = DATASET_COLUMN_TYPES.map(
  (dataType) => ({ value: dataType, label: typeLabel(dataType) }),
)

// 标签里带上原始代码：文档、报错与导出表头里露出来的都是它
export const AGG_OPTIONS: readonly DtSelectOption[] = DATASET_AGG_FUNCS.map(
  (agg) => ({ value: agg, label: `${aggMeta(agg).label} ${agg}` }),
)

/**
 * 聚合口径的下拉选项，必要时把「界面还不认识的那一档」补在末尾。
 * ⚠ 不补的话，后端先于前端上线一档新口径时，编辑那一列的人会看到下拉里
 * **没有它**，随手一选就把配好的口径静默改成了别的（设计 §7.13）。
 * @param current 这一列此刻的口径
 */
export function aggOptionsFor(current: string): DtSelectOption[] {
  if (AGG_OPTIONS.some((one) => one.value === current)) return [...AGG_OPTIONS]
  return [
    ...AGG_OPTIONS,
    { value: current, label: `${current}（界面暂不认识这一档）` },
  ]
}

/**
 * 按 `order_index` 排。
 * ⚠ 不信任后端的返回次序：「顺序」这件事在本页处处被读（上下移的边界、
 * 录入表单的字段序、数据表的列序），排序口径必须只有一处。
 * @param columns 后端给的列
 */
export function sortByOrder(
  columns: readonly DatasetColumn[],
): DatasetColumn[] {
  return [...columns].sort(
    (left, right) => left.order_index - right.order_index,
  )
}

/**
 * 「来源详情」那一格摊开的三段。
 * ⚠ 点位列**先说口径再说点位**：这一格显示的数到底是均值、末值还是增量，
 * 是读数据时的头号疑问，不该非要点进编辑弹窗才知道。
 */
export interface ColumnSourceDetail {
  /** 聚合口径的短标签；只有点位列有。 */
  aggLabel: string | null
  /** 主体：点位身份 / 公式原文 / 一句「人工填写」。 */
  text: string
  /** 悬停时的完整说明。 */
  title: string
}

/**
 * 一列的来源详情。
 * @param column 列定义
 */
export function sourceDetail(column: DatasetColumn): ColumnSourceDetail {
  if (column.source === 'point') return pointDetail(column)
  if (column.source === 'formula') {
    const formula = column.formula ?? ''
    return {
      aggLabel: null,
      text: formula === '' ? '还没写公式' : formula,
      title: formula === '' ? '这一列标成了公式列，但公式是空的。' : formula,
    }
  }
  return {
    aggLabel: null,
    text: '人工填写',
    title: sourceMeta(column.source).hint,
  }
}

/** 点位列的那一格。绑定为空时如实说，不显示成一个空格子。 */
function pointDetail(column: DatasetColumn): ColumnSourceDetail {
  const meta = aggMeta(column.agg)
  const nodeKey = column.node_key ?? ''
  const bound = nodeKey === '' ? '还没绑点位' : nodeKey
  return {
    aggLabel: meta.label,
    text: bound,
    title: `${meta.label}｜${bound}\n${meta.desc}`,
  }
}
