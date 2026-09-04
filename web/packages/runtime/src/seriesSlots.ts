/**
 * @fileoverview 时序槽取数的纯逻辑：从清单声明与该节点的绑定里排出这一轮要取
 * 哪几条、算出去重键，再把取数结论折成一条 `BindingSlot`。
 * ⚠ 这一层一个来源种类都不认识：能不能给出历史序列由清单的 `isTimeSeries` 这条
 * **声明**认出来，绑定上有没有取数说明是第二道判据
 * （docs/DASHBOARD_CHART_MODULES_DESIGN.md §4.3 D5）。
 */
import type {
  BindingSpec,
  BindingView,
  SeriesOutcome,
  SeriesRequest,
} from '@dt/contracts'

import { resolveBindingSpec, type BindingSlot } from './moduleValues'

/** 时序槽绑了一支拿不出历史序列的来源。 */
const NO_SERIES_MESSAGE = '这一档来源给不出历史序列'

/** 这一批取回来了，但里面没有这一条。 */
const MISSING_MESSAGE = '取数没有回这一条'

/** 取数失败且说不出更具体的原因。 */
const UNKNOWN_MESSAGE = '取数失败'

/**
 * 键与键之间的分隔符。
 * ⚠ 用 NUL：`JSON.stringify` 把串里的 NUL 转义成 \u0000 这六个字符，所以真正的
 * NUL 永远不会出现在被拼接的原文里，两段不同的原文拼不出同一个键。
 */
const SEP = '\u0000'

/** 没有取数说明时占位的那一段，与任何序列化结果都不同形。 */
const NO_DETAIL = '-'

/** 还没有首帧的槽。 */
export const PENDING_SLOT: BindingSlot = { state: 'pending' }

/**
 * 能按「键 → 值」摊开的一段值。
 * ⚠ 数组也算：`Object.entries` 给数组的键是下标，元素次序照样分得开，
 * 不必为数组另写一支——而另写一支在这里是永远走不到的死路。
 */
function isEntryBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 键排序的稳定序列化：同一份说明无论键序怎么摆，序列化结果都一样。
 * ⚠ 里面只能放取数说明的**原文**，不许放算好的起止时刻：相对窗每刷新一次都
 * 往前滑一点，把它换算完再放进去的话键次次不同，去重当场作废。
 * ⚠ 键序比较用 `<` 而不是 `localeCompare`：后者不钉 locale 就是本地一种序、
 * CI 另一种序，而这里要的只是「同一份输入给同一个串」。
 * @param value 要序列化的值
 */
function stableStringify(value: unknown): string {
  if (isEntryBag(value)) {
    const body = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    return `{${body.join(',')}}`
  }
  // ⚠ 显式转字符串：`JSON.stringify(undefined)` 给的是 undefined 而不是一个串
  return String(JSON.stringify(value))
}

/**
 * 一条绑定的取数身份：槽键 + 取数说明原文，**不含节拍**。
 * ⚠ 与 `slotKeyOf` 分成两个的理由是「跨节拍不闪」：节拍一跳去重键就变，拿它去
 * 判「还是同一条绑定吗」的话，每个节拍都会把已经画好的曲线打回等首帧。
 * @param binding 要取数的绑定
 */
export function detailKeyOf(binding: BindingView): string {
  return `${binding.fieldKey}${SEP}${stableStringify(binding.detailJson)}`
}

/**
 * 一条绑定在这一轮的去重键。键一变就是换了一次取数。
 * @param binding 要取数的绑定
 * @param epoch 刷新节拍序号
 */
export function slotKeyOf(binding: BindingView, epoch: number): string {
  return `${detailKeyOf(binding)}${SEP}${epoch}`
}

/** 一轮取数的计划。 */
export interface SeriesPlan {
  /** 这一轮要发出去的请求。 */
  requests: SeriesRequest[]
  /** 不必发请求就已经有结论的槽，键是 `fieldKey`。 */
  resolved: Map<string, BindingSlot>
  /** 每条请求的取数身份，键是 `fieldKey`。 */
  detailKeys: Map<string, string>
  /** 这一轮的签名；变了就是换了一次取数。 */
  signature: string
}

export interface SeriesPlanInput {
  /** 模块清单声明的绑定槽。 */
  specs: readonly BindingSpec[]
  /** 该节点的全部绑定。 */
  bindings: readonly BindingView[]
  /** 刷新节拍序号。 */
  epoch: number
}

/**
 * 排出这一轮的取数计划。
 * ⚠ 判据只有两条声明：清单说这是时序槽、绑定带着取数说明。带不出取数说明的
 * 时序槽一律落 `error` 而不是空序列——「时序槽接了一支拿不出历史的来源」这条
 * 最容易踩的路因此被堵死，而这一层照旧不认识任何来源种类。
 * @param input 清单声明的绑定槽、该节点的全部绑定与当前节拍
 */
export function planSeries(input: SeriesPlanInput): SeriesPlan {
  const requests: SeriesRequest[] = []
  const resolved = new Map<string, BindingSlot>()
  const detailKeys = new Map<string, string>()
  const parts: string[] = []
  for (const binding of input.bindings) {
    if (
      resolveBindingSpec(input.specs, binding.fieldKey)?.isTimeSeries !== true
    )
      continue
    const detail = binding.detailJson
    if (detail === null) {
      resolved.set(binding.fieldKey, {
        state: 'error',
        message: NO_SERIES_MESSAGE,
      })
      parts.push(`${binding.fieldKey}${SEP}${NO_DETAIL}`)
      continue
    }
    requests.push({ fieldKey: binding.fieldKey, detail })
    detailKeys.set(binding.fieldKey, detailKeyOf(binding))
    parts.push(slotKeyOf(binding, input.epoch))
  }
  return { requests, resolved, detailKeys, signature: parts.join('\n') }
}

/**
 * 一条取数结论折成一条绑定槽。
 * ⚠ `ok` 档一律不写采样时刻：那一档记的是「有人在往这条槽里推值」，而历史序列
 * 是一次性拉回来的，写了会让实时通道一抖就把一屏图表全标成可能过期。时刻在
 * `points` 里。
 * ⚠ 取到了但窗内 0 点是 `ok` + 空数组 + 空标量，与「取不到」是两码事：前者让
 * 整块折成空态，后者在图例上逐条说明。
 * @param outcome 取数适配器给出的结论
 */
export function slotOfOutcome(outcome: SeriesOutcome): BindingSlot {
  if (outcome.state === 'error') {
    return { state: 'error', message: outcome.message }
  }
  const last = outcome.points.at(-1)
  return {
    state: 'ok',
    value: last === undefined ? null : last.v,
    points: outcome.points,
    isTruncated: outcome.isTruncated,
    isStale: outcome.isStale,
  }
}

/**
 * 把一批取数结论摊回槽表。
 * ⚠ 请求发了却没回这一条，也是取不到：留空的话屏上是一张看不出问题的空图。
 * @param plan 发起这一轮的计划
 * @param outcomes 取数适配器回的表
 */
export function slotsOfOutcomes(
  plan: SeriesPlan,
  outcomes: ReadonlyMap<string, SeriesOutcome>,
): Map<string, BindingSlot> {
  const slots = new Map(plan.resolved)
  for (const request of plan.requests) {
    const outcome = outcomes.get(request.fieldKey)
    slots.set(
      request.fieldKey,
      outcome === undefined
        ? { state: 'error', message: MISSING_MESSAGE }
        : slotOfOutcome(outcome),
    )
  }
  return slots
}

/**
 * 整批取数失败：每一条都诚实说取不到，不留一张空图。
 * @param plan 发起这一轮的计划
 * @param message 失败原因
 */
export function slotsOfFailure(
  plan: SeriesPlan,
  message: string,
): Map<string, BindingSlot> {
  const slots = new Map(plan.resolved)
  for (const request of plan.requests) {
    slots.set(request.fieldKey, { state: 'error', message })
  }
  return slots
}

/**
 * 这一轮开跑时先摆上的槽：取数身份没变的沿用上一轮的结果，其余等首帧。
 * ⚠ 不沿用的话每个节拍都会把画好的曲线打回空白再画回来；只按 `fieldKey` 沿用
 * 又会在换了绑定之后短暂画出上一条绑定的曲线，所以比的是取数身份。
 * @param plan 这一轮的计划
 * @param previous 上一轮的槽表
 * @param carried 上一轮每条请求的取数身份
 */
export function openingSlots(
  plan: SeriesPlan,
  previous: ReadonlyMap<string, BindingSlot>,
  carried: ReadonlyMap<string, string>,
): Map<string, BindingSlot> {
  const slots = new Map(plan.resolved)
  for (const request of plan.requests) {
    const same =
      carried.get(request.fieldKey) === plan.detailKeys.get(request.fieldKey)
    const kept = same ? previous.get(request.fieldKey) : undefined
    slots.set(request.fieldKey, kept ?? PENDING_SLOT)
  }
  return slots
}

/**
 * 异常里那句能摆到图例上的话。
 * @param error 取数抛出来的东西
 */
export function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return typeof error === 'string' && error !== '' ? error : UNKNOWN_MESSAGE
}
