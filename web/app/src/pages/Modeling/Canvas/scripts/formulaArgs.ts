/**
 * @fileoverview 公式的实参从哪来：这一步的讲解块、逐路摘要，与运行时冻结的 config。
 *
 * ⚠ 三处各有各的时效（规格 §6）：config 是**运行时冻结的快照**，所以历史回看也
 * 正确；讲解块是这一次真跑出来的数；摘要里的系数只有能用 JSON 写出来的模型才有。
 * ⚠ 取不到就返回 null，一路交给 `FormulaSpec.fallback` 说清是哪一种取不到——
 * 拿手边的数顶上去，公式会印出一串看着完全正常的假账（§2-P4）。
 */
import type { FormulaNode } from './formula'
import { percentText } from './numbers'
import type { PortPreview } from './preview'
import type { FramePreview, ModelPreview } from './preview'
import type { ReportBlock } from './reportBlocks'
import { recordOf } from './reportBlocks'

/** 变量表的一行：这个符号是什么。 */
export interface FormulaLegend {
  symbol: string
  text: string
}

/** 一条公式。符号态永远画得出来，代入态取不到实参时为 null。 */
export interface FormulaSpec {
  id: string
  title: string
  symbolic: FormulaNode[]
  filled: FormulaNode[] | null
  /** 想代实参却代不进时说明为什么；纯口径说明式没有实参可代，这里是 null。 */
  fallback: string | null
  /** 默认展开：有实参且实参就是结论的那几条。 */
  isOpen: boolean
  legend: FormulaLegend[]
  notes: string[]
}

/** 代实参要用到的三样东西：这一步的讲解块、逐端口摘要，与那份 config 快照。 */
export interface FormulaContext {
  blocks: readonly ReportBlock[]
  ports: readonly PortPreview[]
  config: Readonly<Record<string, unknown>>
}

export type FormulaMaker = (context: FormulaContext) => FormulaSpec

/** 四种「代不进」的措辞。合并了就分不清该改配置、该重跑，还是本来就没有。 */
export const NO_BLOCK = '这一步的讲解里没有这一块，代不进实参'
export const NO_CONFIG = '这次运行没有记下这个参数，代不进实参'
export const NO_FRAME = '这一步的结果摘要里没有这一路的帧，代不进实参'

type Item = Record<string, unknown>

export function numberAt(
  config: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function textAt(
  config: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

/** config 里的一串名字。读不出来就是空数组，不是抛错。 */
export function textsAt(
  config: Readonly<Record<string, unknown>>,
  key: string,
): string[] {
  const value = config[key]
  if (!Array.isArray(value)) return []
  return value.filter((one): one is string => typeof one === 'string')
}

/** config 里的一串数。⚠ 顺序照原样留着：`lags` 的先后是用户配的。 */
export function numbersAt(
  config: Readonly<Record<string, unknown>>,
  key: string,
): number[] {
  const value = config[key]
  if (!Array.isArray(value)) return []
  return value.filter(
    (one): one is number => typeof one === 'number' && Number.isFinite(one),
  )
}

export function frameAt(
  ports: readonly PortPreview[],
  port: string,
): FramePreview | null {
  for (const item of ports) {
    if (item.port === port && item.preview.kind === 'frame') return item.preview
  }
  return null
}

export function modelAt(ports: readonly PortPreview[]): ModelPreview | null {
  for (const item of ports) {
    if (item.preview.kind === 'model') return item.preview
  }
  return null
}

/**
 * 同屏 model 端口上的一个超参。读不到就是空串。
 *
 * ⚠ 它与 config 快照互补、不是二选一：快照只保证有建节点时种进去的那些键，
 * 而超参是这次运行自己带出来的一份全量（`regression.py::_hyper_params_of`）。
 * ⚠ 值是字符串：摘要那一侧已经过一次 `String()`（`preview.ts::modelOf`）。
 * Args: ports, key。
 */
export function hyperAt(ports: readonly PortPreview[], key: string): string {
  const model = modelAt(ports)
  if (model === null) return ''
  for (const [name, value] of model.hyperParams) {
    if (name === key) return value
  }
  return ''
}

/**
 * 一个数值超参。⚠ 空串要单独拦：`Number('')` 是 0 不是 NaN，缺的参数会变成 0。
 * Args: ports, key。
 */
export function hyperNumber(
  ports: readonly PortPreview[],
  key: string,
): number | null {
  const text = hyperAt(ports, key)
  const value = Number(text)
  return text !== '' && Number.isFinite(value) ? value : null
}

/**
 * 挑一块讲解。同一种块可能有好几块（分布图逐列一张），故按标题再收一次窄。
 *
 * Args: blocks, kind, title——空串 = 这一种的第一块。
 */
export function blockAt(
  blocks: readonly ReportBlock[],
  kind: string,
  title = '',
): ReportBlock | null {
  for (const one of blocks) {
    if (one.kind !== kind) continue
    if (title !== '' && one.title !== title) continue
    return one
  }
  return null
}

/** 一块 `fits` 里逐列的拟合参数。读不出来就是空数组。 */
export function fitParamsOf(block: ReportBlock | null): Item[] {
  if (block === null) return []
  const list = block.payload['by_column']
  if (!Array.isArray(list)) return []
  return list.map((one) => recordOf(one))
}

/** 第一列的拟合参数：公式只举一列做范例，逐列的账在表里。 */
export function firstParams(items: readonly Item[]): [string, Item] | null {
  const head = items[0]
  if (head === undefined) return null
  const key = head['key']
  return typeof key === 'string' ? [key, recordOf(head['params'])] : null
}

/** 一块 `breakdown` 里的逐项。读不出来就是空数组。 */
export function breakdownItems(block: ReportBlock | null): Item[] {
  if (block === null) return []
  const list = block.payload['items']
  if (!Array.isArray(list)) return []
  return list.map((one) => recordOf(one))
}

/**
 * 按 `key` 或 `name` 挑一项。
 *
 * ⚠ 两个都认：`breakdown` 的逐项有的带机器码 `key`（回归指标），有的只有中文
 * `name`（逐折分数）。
 * Args: items, key。
 */
export function itemAt(items: readonly Item[], key: string): Item | null {
  for (const one of items) {
    if (one['key'] === key || one['name'] === key) return one
  }
  return null
}

export function numberIn(item: Item, key: string): number | null {
  const value = item[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 百分数写法。⚠ 一律过 `percentText`：`0.2*100` 在浮点上是 20.000000000000004。 */
export function percent(ratio: number): string {
  return percentText(ratio * 100)
}
