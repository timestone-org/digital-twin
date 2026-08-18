/**
 * @fileoverview metric-card 的取值逻辑：把「一行指标配置 + 这一槽的取数结论」
 * 算成一格要画的东西（文本、单位、严重度、时刻、为什么没值）。纯函数，不碰 DOM。
 *
 * ⚠ 这里最要紧的是**四档分开**：没配来源／还没首帧／取不到／有值。四档在
 * `values` 里长得一模一样（键都不存在），全靠 `meta.slots` 分开——合成一档的
 * 代价是现场断了的那一格与从没配过的那一格在墙上是同一个「—」
 * （DASHBOARD_DESIGN §4.3）。
 */
import type { ModuleSlotMeta } from '@dt/contracts'

import {
  readArray,
  readEnum,
  readLooseNumber,
  readNumber,
  readRecord,
  readTrimmedText,
} from '../../shared/config'
import { fmtClock, fmtDecimal, isPresent } from '../../shared/format'
import {
  evaluateThresholds,
  type ThresholdHit,
  type ThresholdLevel,
  type ThresholdRule,
} from '../../shared/thresholds'

/**
 * 指标读数的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错
 * 也永远取不到值（`TWIN_VIEW_BINDINGS` 的文件头写了同一条）。
 */
export const METRIC_SLOT_KEY = 'itemValues'

/** 指标列表的配置键。 */
export const METRIC_ITEMS_KEY = 'items'

/** 值的展示语义。⚠ 与阈值无关：阈值一律拿**原始数值**判，见 `cellLevel`。 */
export const METRIC_KINDS = ['number', 'boolean', 'text'] as const
export type MetricKind = (typeof METRIC_KINDS)[number]

/** 归一化后的一项指标配置。 */
export interface MetricItem {
  label: string
  unit: string
  precision: number
  kind: MetricKind
  trueText: string
  falseText: string
  /** 联动上抛的值；空串 = 这一格点了不上抛。 */
  key: string
  /** 四段带的四条边界，`null` = 这一侧不判。 */
  dangerBelow: number | null
  warnBelow: number | null
  warnAbove: number | null
  dangerAbove: number | null
}

/**
 * 一格此刻处在哪一档。
 * ⚠ `unbound` 与 `pending` 必须分开：前者要去配绑定，后者只要再等一会儿，
 * 而合成「暂无数据」之后，两种处置办法就都看不出来了。
 */
export const CELL_STATES = ['ok', 'pending', 'error', 'unbound'] as const
export type CellState = (typeof CELL_STATES)[number]

/** 一格要画的全部东西。 */
export interface MetricCell {
  /** `v-for` 的键：行号加标签，删掉中间一行时其余行不会整体错位。 */
  key: string
  label: string
  state: CellState
  /** 值的展示文本；非 `ok` 档是占位符。 */
  text: string
  /** 单位；⚠ 非 `ok` 档一律空串——「— kV」看着像是有读数的。 */
  unit: string
  /** 严重度；没配阈值或没有值时 `null`，那时一个点都不画。 */
  level: ThresholdLevel | null
  /** 阈值命中的告警文案，没有则空串。 */
  hitLabel: string
  /** 命中的那一档要不要闪。 */
  blink: boolean
  /** 这一格为什么没有值，一句完整的话；`ok` 档是空串。 */
  reason: string
  /** 同一件事的短标签，画在格子里；`ok` 档是空串。 */
  stateLabel: string
  /** 采样时刻的 `HH:mm:ss`；没有则空串。 */
  updatedAt: string
  /** 联动上抛值；空串 = 不上抛。 */
  emitValue: string
}

/** 各档没有值时给看的人的一句话，鼠标停上去才看得全。 */
const REASONS: Record<Exclude<CellState, 'ok'>, string> = {
  unbound: '这一格还没绑定数据来源',
  pending: '已绑定，还没收到第一帧',
  error: '取不到',
}

/**
 * 画在格子里的短标签。
 * ⚠ 三档各有各的字：合成一个「暂无数据」之后，该去配绑定、该再等一会儿、
 * 该去查现场这三种处置办法就都看不出来了。
 */
const STATE_LABELS: Record<Exclude<CellState, 'ok'>, string> = {
  unbound: '未绑定',
  pending: '等待首帧',
  error: '取不到',
}

/**
 * 第 index 项读数的 `fieldKey`。
 * ⚠ index 是**归一化输出**里的文档序：派生绑定行与读值必须喂同一份列表，
 * 喂原始配置会因为脏行被丢弃而让其后每一行整体错位一格。
 * @param index 归一化后的下标
 */
export function metricFieldKey(index: number): string {
  return `${METRIC_SLOT_KEY}[${index}].value`
}

/**
 * 把配置里的一行规整成指标。缺什么补什么，不丢行——理由见 `readMetricItems`。
 * @param raw 配置数组里的一行
 */
function toItem(raw: unknown): MetricItem {
  const row = readRecord(raw)
  return {
    label: readTrimmedText(row.label),
    unit: readTrimmedText(row.unit),
    precision: Math.round(readNumber(row.precision, 1)),
    kind: readEnum(row.kind, METRIC_KINDS, 'number'),
    trueText: readTrimmedText(row.trueText, '运行'),
    falseText: readTrimmedText(row.falseText, '停止'),
    key: readTrimmedText(row.key),
    dangerBelow: readLooseNumber(row.dangerBelow),
    warnBelow: readLooseNumber(row.warnBelow),
    warnAbove: readLooseNumber(row.warnAbove),
    dangerAbove: readLooseNumber(row.dangerAbove),
  }
}

/**
 * 指标列表的归一化。
 * ⚠ 脏行不丢、只补默认：丢一行会让它之后每一条绑定改喂另一个指标，
 * 而绑定的 `fieldKey` 是按下标拼的（`metricFieldKey` 的注释）。
 * @param raw `config.items` 的原值
 */
export function readMetricItems(raw: unknown): MetricItem[] {
  return readArray(raw).map(toItem)
}

/**
 * 四段带 → 阈值规则，声明序即优先级：两条危险在前，压过预警。
 * ⚠ 上下界都是**开区间**：`warnAbove: 80` 的语义是「超过 80 才预警」，
 * 等于 80 不预警。写成闭区间会让「上限就是 80」的工况一直挂着黄灯。
 * @param item 归一化后的指标
 */
export function boundaryRules(item: MetricItem): ThresholdRule[] {
  // ⚠ 每条都带文案：只有颜色的话，色弱的人与打印出来的截图上，
  //   越了哪一侧的界完全看不出来
  const bounds: readonly [
    number | null,
    'lt' | 'gt',
    ThresholdLevel,
    string,
  ][] = [
    [item.dangerBelow, 'lt', 'danger', '过低'],
    [item.dangerAbove, 'gt', 'danger', '过高'],
    [item.warnBelow, 'lt', 'warning', '偏低'],
    [item.warnAbove, 'gt', 'warning', '偏高'],
  ]
  const rules: ThresholdRule[] = []
  for (const [value, op, level, label] of bounds) {
    if (value !== null) rules.push({ op, value, level, label })
  }
  return rules
}

/** 这一项配没配过阈值边界。没配就连「正常」都不该说——我们没有判据。 */
function hasBounds(item: MetricItem): boolean {
  return boundaryRules(item).length > 0
}

/**
 * 布尔档的真假判定。
 * ⚠ 数值 `0` 是假、非零是真：工控点位的开关量绝大多数是 0/1 的数值而不是
 * JSON 布尔，只认 `true` 会让每一台运行中的设备都显示成「停止」。
 * @param raw 槽里的原值
 */
function toBool(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (isPresent(raw)) return raw !== 0
  return null
}

/**
 * 有值那一档的展示文本。
 * @param raw 槽里的原值
 * @param item 归一化后的指标
 * @param grouping 数值要不要千分位
 */
function valueText(raw: unknown, item: MetricItem, grouping: boolean): string {
  if (item.kind === 'boolean') {
    const flag = toBool(raw)
    if (flag !== null) return flag ? item.trueText : item.falseText
  }
  if (item.kind === 'number' && isPresent(raw)) {
    return fmtDecimal(raw, item.precision, grouping)
  }
  // text 档，以及数值/布尔档收到了认不出的值：照实显示原值，
  // ⚠ 不静默换成占位符——「现场报的就是这么个东西」本身就是要看的信息
  return typeof raw === 'string' ? raw : String(raw)
}

/**
 * 这一格的严重度。
 * ⚠ 一律拿**原始数值**判，与展示档无关：布尔档的 0/1 也要能触发红灯，
 * 而按展示文本判就只能比字符串了。
 * @param raw 槽里的原值
 * @param item 归一化后的指标
 */
function cellLevel(raw: unknown, item: MetricItem): ThresholdHit | null {
  return evaluateThresholds(raw, boundaryRules(item))
}

/**
 * 一格的展示口径，整块共用一份。
 * ⚠ 收成一个对象而不是逐项当 prop：格子组件的 prop 数量有上限，而这几项
 * 每加一个展示开关就要多一个（code-style-typescript §3）。
 */
export interface MetricLook {
  align: 'left' | 'center'
  /** 读数字号，px。⚠ 已经是解析过的实际值，`0` 那一档由壳按排布换算完了。 */
  valueSize: number
  labelSize: number
  /** 没有告警时的读数颜色。 */
  valueColor: string
  showStatusDot: boolean
  showUpdatedAt: boolean
  /** 列表行式排布：名称在左、读数在右。 */
  isRow: boolean
}

export interface MetricCellsInput {
  items: readonly MetricItem[]
  /** `values[METRIC_SLOT_KEY]` 的原值，正常是一个行数组。 */
  rows: unknown
  /** `meta.slots`；缺席表示运行时没下发逐槽结论（设计态与独立挂载）。 */
  slots: Readonly<Record<string, ModuleSlotMeta>> | undefined
  /** 没有值时画什么。 */
  emptyText: string
  /** 数值要不要千分位。 */
  grouping: boolean
}

/** 取第 index 行注入的原值；没有这一行给 undefined。 */
function rowValue(rows: unknown, index: number): unknown {
  const row = readArray(rows)[index]
  return row === undefined ? undefined : readRecord(row).value
}

/**
 * 这一格叫什么。没填名字的行退回「指标 N」——绑点面板与格子上必须是同一个字，
 * 否则用户在两处看到两个名字，只能靠数行号对上。
 * @param item 归一化后的指标
 * @param index 文档序下标
 */
function displayLabel(item: MetricItem, index: number): string {
  return item.label === '' ? `指标 ${index + 1}` : item.label
}

/** 有读数那一档的读数与单位；其余档给占位符且**不给单位**。 */
function readingOf(
  state: CellState,
  raw: unknown,
  item: MetricItem,
  input: MetricCellsInput,
): { text: string; unit: string } {
  if (state !== 'ok') return { text: input.emptyText, unit: '' }
  return { text: valueText(raw, item, input.grouping), unit: item.unit }
}

/** 没有读数时的两句话：短标签画在格子里，完整原因挂 `title`。 */
function absenceOf(
  state: CellState,
  slot: ModuleSlotMeta | undefined,
): { reason: string; stateLabel: string } {
  if (state === 'ok') return { reason: '', stateLabel: '' }
  return { reason: reasonOf(state, slot), stateLabel: STATE_LABELS[state] }
}

/**
 * 这一格的严重度与告警文案。
 * ⚠ 没有读数时一律不着色：凭空一个绿灯等于宣布「一切正常」，
 * 而这时候我们根本没有值。
 */
function severityOf(
  state: CellState,
  raw: unknown,
  item: MetricItem,
): { level: ThresholdLevel | null; hitLabel: string; blink: boolean } {
  const hit = state === 'ok' ? cellLevel(raw, item) : null
  if (hit !== null) {
    return { level: hit.level, hitLabel: hit.label ?? '', blink: hit.blink }
  }
  // 配了边界又没命中才叫「正常」；没配边界时我们没有判据，一个点都不画
  const isNormal = state === 'ok' && hasBounds(item)
  return { level: isNormal ? 'normal' : null, hitLabel: '', blink: false }
}

/**
 * 一项配置 + 一条槽结论 → 一格。
 * @param item 归一化后的指标
 * @param index 文档序下标
 * @param input 整块的输入
 */
function toCell(
  item: MetricItem,
  index: number,
  input: MetricCellsInput,
): MetricCell {
  const slot = input.slots?.[metricFieldKey(index)]
  const raw = rowValue(input.rows, index)
  const state = cellState(slot, raw, input.slots !== undefined)
  return {
    // ⚠ 键带上标签：纯序号做键时删掉中间一项会让其余格整体错位
    key: `${index}:${item.label}`,
    label: displayLabel(item, index),
    state,
    ...readingOf(state, raw, item, input),
    ...severityOf(state, raw, item),
    ...absenceOf(state, slot),
    updatedAt:
      slot?.timestampMs === undefined ? '' : fmtClock(slot.timestampMs),
    emitValue: item.key,
  }
}

/**
 * 这一格落在哪一档。
 * @param slot 这一槽的取数结论；缺席 = 没配来源，或运行时没下发结论
 * @param raw 注入袋里这一行的原值
 * @param hasSlots 运行时下发了逐槽结论没有
 */
function cellState(
  slot: ModuleSlotMeta | undefined,
  raw: unknown,
  hasSlots: boolean,
): CellState {
  if (slot !== undefined) return slot.state
  // ⚠ 没下发结论时只能退回「有没有值」这一条判据：设计态画布与独立挂载走这里。
  //   此时把没有值一律说成 unbound 是诚实的——那两处本来就没有取数
  if (!hasSlots) return raw === undefined ? 'unbound' : 'ok'
  return 'unbound'
}

/** 没有值的那一句话；`error` 档带上取数侧给的原因。 */
function reasonOf(state: CellState, slot: ModuleSlotMeta | undefined): string {
  if (state === 'ok') return ''
  const base = REASONS[state]
  const detail = slot?.message ?? ''
  return detail === '' ? base : `${base}：${detail}`
}

/**
 * 摊出整块要画的格子。
 * @param input 指标列表、注入袋、逐槽结论与两项展示口径
 */
export function buildMetricCells(input: MetricCellsInput): MetricCell[] {
  return input.items.map((item, index) => toCell(item, index, input))
}

/**
 * 绑点面板上每一行叫什么：名字给人看，id 给人核对。
 * ⚠ 只给名字的话，两个同名指标在面板上长得一模一样，用户只能靠数行号
 * 确认自己绑对了没有（DASHBOARD_DESIGN §5.2）。
 * @param items 归一化后的指标列表
 */
export function metricRowLabels(
  items: readonly MetricItem[],
): Record<string, { title: string; id: string }> {
  const labels: Record<string, { title: string; id: string }> = {}
  items.forEach((item, index) => {
    labels[metricFieldKey(index)] = {
      title: displayLabel(item, index),
      id: item.key,
    }
  })
  return labels
}

/** 数组槽应有几行：跟着指标列表走，绑点面板因此不摆手工增删键。 */
export function metricRowCounts(
  items: readonly MetricItem[],
): Record<string, number> {
  return { [METRIC_SLOT_KEY]: items.length }
}
