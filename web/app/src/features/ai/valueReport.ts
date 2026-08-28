/**
 * @fileoverview `dashboard.read_values` 的取值形状（docs/AI_ASSISTANT_V3_PLAN.md §2.2）：
 * 一批行 + 画布用的那份快照缓存 → 每一行此刻是什么读数。
 *
 * ⚠ 读的必须是**画布渲染同一个取数源**（`usePointSamples` 那一份），不另发请求：
 * 另发一次会出现「助手说有值、画面上是占位符」。
 * ⚠ `waiting` 与 `unavailable` **必须分开**：合成一档的话，「刚保存还没到下一拍」
 * 会被模型读成「这个点位是坏的」，然后它去把绑定改掉。
 */
import type { BindingView } from '@dt/contracts'

import type { ReadPointSample } from '@/runtime/bindingReader'
import type { BindingRowInput } from './bindingReport'

/** 一份取值报告最多列几条。整屏几千条时，列到第 200 条也没人读得完。 */
const MAX_ITEMS = 200

/**
 * 一行此刻的取数结论。
 * `has_value` 有值、`waiting` 订上了还没来第一帧、`unavailable` 取不到、
 * `unbound` 压根没配来源。
 */
export const VALUE_STATUSES = [
  'has_value',
  'waiting',
  'unavailable',
  'unbound',
] as const

export type ValueStatus = (typeof VALUE_STATUSES)[number]

/** 报告里的一条。 */
export interface ValueReportItem {
  field_key: string
  /** 这一行喂谁；没有名字时是空串。 */
  entity: string
  node_key: string | null
  source_kind: string | null
  value: unknown
  /** 采样时刻，UTC RFC3339；没有读数时为 null。 */
  at: string | null
  status: ValueStatus
  /**
   * 这一档为什么是这一档，给模型看。
   * ⚠ 没有它的话，画布本来就不展开的序列类绑定（点位历史 / 台账）会被读成
   * 「这个点位坏了」，模型接着就去把一条好好的绑定改掉。
   */
  note: string
}

/** 一次取值报告。 */
export interface ValueReport {
  items: ValueReportItem[]
  /** 一条来源都没配的行数。 */
  unbound_count: number
  is_truncated: boolean
}

/**
 * 一行连着它此刻接的那条绑定。
 * ⚠ 成对进来而不是「行表 + 绑定表」两张：整屏读数时十块卡片上的
 * `itemValues[0].value` 是同一个 fieldKey，按 fieldKey 建一张表会让后一块的
 * 绑定盖掉前一块的——每一行都读得出值，读的却是别人的点位。
 */
export interface ValueRow {
  row: BindingRowInput
  /** 这一行接的绑定；没接给 null。 */
  binding: BindingView | null
}

export interface ValueReportInput {
  rows: readonly ValueRow[]
  /** 画布那份快照缓存的查询函数。 */
  read: ReadPointSample
  /** 最多列几条；不给用 200。 */
  maxItems?: number
}

/** 序列类来源在画布上本来就不展开，不是坏了。 */
const SERIES_NOTE = '序列要异步取数，画布上不展开'
const NO_POINT_NOTE = '实时绑定还没挑点位'
const NO_SOURCE_NOTE = '这一行还没配来源'
const NO_CONSTANT_NOTE = '常量绑定没有值'
const WAITING_NOTE = '已订阅，还没收到第一帧'

/** 一条绑定此刻的结论，不含 `field_key` 与 `entity` 那两格。 */
type Reading = Pick<ValueReportItem, 'value' | 'at' | 'status' | 'note'>

const UNBOUND: Reading = {
  value: null,
  at: null,
  status: 'unbound',
  note: NO_SOURCE_NOTE,
}

/** 采样时刻 → RFC3339。 */
function atOf(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

/** 实时点位这一档。 */
function pointReading(nodeKey: string, read: ReadPointSample): Reading {
  const sample = read(nodeKey)
  if (sample === undefined) {
    return { value: null, at: null, status: 'waiting', note: WAITING_NOTE }
  }
  if (sample.state === 'error') {
    return {
      value: null,
      at: null,
      status: 'unavailable',
      note: sample.errorMessage,
    }
  }
  return {
    value: sample.value,
    at: atOf(sample.timestampMs),
    status: 'has_value',
    note: '',
  }
}

/**
 * 一条绑定此刻是什么读数。
 * ⚠ `0` / `false` / `''` 都是合法常量，不许按真假判——按真假判会让一屏
 * 「常量 0」全部报成没配过。
 */
function readingOf(binding: BindingView, read: ReadPointSample): Reading {
  const kind = binding.sourceKind
  if (kind === 'opcua') {
    if (binding.nodeKey === null) {
      return { ...UNBOUND, note: NO_POINT_NOTE }
    }
    return pointReading(binding.nodeKey, read)
  }
  if (kind === 'static') {
    const value = binding.staticValueJson
    if (value === null || value === undefined) {
      return {
        value: null,
        at: null,
        status: 'unbound',
        note: NO_CONSTANT_NOTE,
      }
    }
    return { value, at: null, status: 'has_value', note: '' }
  }
  // 派生与两种序列类都取不到同步值：说清楚是哪一种，不留白
  return {
    value: null,
    at: null,
    status: 'unavailable',
    note: kind === 'computed' ? '派生值由渲染层就地算' : SERIES_NOTE,
  }
}

/**
 * 一处的行表配上它自己那份绑定。
 * @param rows 这一处的行
 * @param bindings 这一处的绑定
 */
export function pairRows(
  rows: readonly BindingRowInput[],
  bindings: readonly BindingView[],
): ValueRow[] {
  const bound = new Map(bindings.map((one) => [one.fieldKey, one]))
  return rows.map((row) => ({ row, binding: bound.get(row.fieldKey) ?? null }))
}

/**
 * 把一批行读成一份取值报告。
 * @param input 要报的行、画布那份快照缓存、条数上限
 */
export function valueReport(input: ValueReportInput): ValueReport {
  const limit = input.maxItems ?? MAX_ITEMS
  const kept = input.rows.slice(0, limit)
  const items = kept.map(({ row, binding }) => ({
    field_key: row.fieldKey,
    entity: row.label,
    node_key: binding?.nodeKey ?? null,
    source_kind: binding?.sourceKind ?? null,
    ...(binding === null ? UNBOUND : readingOf(binding, input.read)),
  }))
  return {
    items,
    unbound_count: items.filter((one) => one.status === 'unbound').length,
    is_truncated: input.rows.length > kept.length,
  }
}
