/**
 * @fileoverview 实时读数 → 推荐入参的换算，与「这份读数有多旧」的判定。
 *
 * ⚠ 全文最容易出错的一处：`ModelPredictReadings` 的字段是**可选**的，语义是
 * 「省略 = 缺测」；而 live-readings 给的是 `number | null`。把 null 原样塞进去
 * 会变成 JSON 的 `null`，和「没这个字段」不是一回事。
 */
import type {
  AcModel,
  AcUnitLiveReading,
  AcUnitReadingValues,
  DtIntent,
  ModelPredictReadings,
  ModelRecommendResult,
  RoomLiveReadings,
} from '@dt/contracts'

import { formatSet } from './modelView'

/**
 * 超过这么多分钟没有新行就算陈旧。
 * EMS 侧是秒级到分钟级的采集周期，5 分钟没有新行说明这台的采集出了问题，
 * 而不是正常抖动；它小于后端 15 分钟的回看窗——窗内有数据但已经很旧，
 * 正是最需要提醒的那种情况。
 */
export const LIVE_STALE_MINUTES = 5

/** 五项读数的键序，与推荐入参逐一对应。 */
export const LIVE_READING_KEYS = [
  'workshop_temp_avg',
  'workshop_humidity_avg',
  'fresh_air_temp',
  'fresh_air_humidity',
  'chilled_water_supply_temp',
] as const satisfies readonly (keyof AcUnitReadingValues)[]

/** 一台的读数草稿：预填实时值，清空 = 缺测。 */
export type ReadingDraft = Record<string, AcUnitReadingValues>

/** 一台的实时读数 → 推荐入参。⚠ null 的字段整个省略，不发 null 也不填 0。 */
export function toPredictReadings(
  values: AcUnitReadingValues,
): ModelPredictReadings {
  const out: ModelPredictReadings = {}
  for (const key of LIVE_READING_KEYS) {
    const value = values[key]
    if (value !== null) out[key] = value
  }
  return out
}

/** 五项全缺 = 这台没有任何可用读数。 */
export function hasAnyReading(values: AcUnitReadingValues): boolean {
  return LIVE_READING_KEYS.some((key) => values[key] !== null)
}

/**
 * 草稿 → 推荐入参字典。
 * ⚠ 五个字段全省的那台**整台不进**字典：空对象与「没有这台」对模型是两回事。
 * @param draft 逐台的读数草稿
 */
export function toRecommendReadings(
  draft: Readonly<ReadingDraft>,
): Record<string, ModelPredictReadings> {
  const out: Record<string, ModelPredictReadings> = {}
  for (const [serial, values] of Object.entries(draft)) {
    if (hasAnyReading(values)) out[serial] = toPredictReadings(values)
  }
  return out
}

/** 实时读数 → 可编辑草稿。 */
export function draftFromUnits(
  units: readonly AcUnitLiveReading[],
): ReadingDraft {
  const draft: ReadingDraft = {}
  for (const unit of units) draft[unit.serial] = { ...unit.readings }
  return draft
}

/**
 * 草稿与实时值不一样了吗——决定要不要打「已手动调整」的标。
 * @param draft 当前草稿
 * @param units 这一次取回来的实时读数
 */
export function isDraftEdited(
  draft: Readonly<ReadingDraft>,
  units: readonly AcUnitLiveReading[],
): boolean {
  return units.some((unit) => {
    const edited = draft[unit.serial]
    if (edited === undefined) return false
    return LIVE_READING_KEYS.some((key) => edited[key] !== unit.readings[key])
  })
}

/**
 * `as_of` 与 `sampled_at` 差多少分钟；`sampled_at` 为 null 返回 null。
 * @param asOf 服务端取数时刻
 * @param sampledAt 这台最后一行的时刻
 */
export function stalenessMinutes(
  asOf: string,
  sampledAt: string | null,
): number | null {
  if (sampledAt === null) return null
  const end = Date.parse(asOf)
  const start = Date.parse(sampledAt)
  if (Number.isNaN(end) || Number.isNaN(start)) return null
  return Math.max(0, (end - start) / 60000)
}

/** 这台的读数已经旧到要提醒了吗。 */
export function isStaleReading(
  asOf: string,
  sampledAt: string | null,
): boolean {
  const minutes = stalenessMinutes(asOf, sampledAt)
  return minutes !== null && minutes > LIVE_STALE_MINUTES
}

/** 陈旧的台数与其中最旧的那台旧了多少分钟。 */
export function staleStats(readings: RoomLiveReadings | null): {
  count: number
  minutes: number
} {
  if (readings === null) return { count: 0, minutes: 0 }
  const overdue = readings.units
    .map((unit) => stalenessMinutes(readings.as_of, unit.sampled_at))
    .filter(
      (minutes): minutes is number =>
        minutes !== null && minutes > LIVE_STALE_MINUTES,
    )
  return { count: overdue.length, minutes: Math.max(0, ...overdue) }
}

/**
 * 服务组合里没出现在推荐结果中的那些。
 * ⚠ 必须列出来：静默少几行 = 用户以为那些组合不存在。
 * @param found 当前模型
 * @param result 这一次的推荐结果
 */
export function missingSetKeys(
  found: AcModel | null,
  result: ModelRecommendResult | null,
): string[] {
  if (found === null || result === null) return []
  const answered = new Set(result.items.map((item) => item.set_key))
  return found.serving_sets.map(formatSet).filter((key) => !answered.has(key))
}

/** 顶部提示区要说的一件事。 */
export interface LiveNotice {
  id: string
  intent: DtIntent
  text: string
}

/** 判定这些提示要不要出现所需的全部事实。 */
export interface LiveNoticeInput {
  /** 模型此刻正在排队或训练，但带着上一次的工件。 */
  isRetraining: boolean
  /** 上一次重训失败了，用的是更早那一次成功训练的工件。 */
  isLastTrainingFailed: boolean
  /** 弹窗开着的时候这个模型重训完了。 */
  isModelRetrained: boolean
  resultEdited: boolean
  resultBlind: boolean
  staleCount: number
  staleMinutes: number
  missingCount: number
  allMissing: boolean
}

interface NoticeRule {
  id: string
  intent: DtIntent
  when: (input: LiveNoticeInput) => boolean
  text: (input: LiveNoticeInput) => string
}

/**
 * ⚠ 三处「陈旧」都必须说出来：训练中显示上一次评估、推荐用上一次工件、
 * EMS 读数超过阈值——静默端上来的旧结论会被当成实时结论拿去开机。
 */
const NOTICE_RULES: readonly NoticeRule[] = [
  {
    id: 'retraining',
    intent: 'info',
    when: (input) => input.isRetraining,
    text: () =>
      '模型正在重训；这次用的是上一次训练的工件，与页面上的评估同源。',
  },
  {
    id: 'last-failed',
    intent: 'warning',
    when: (input) => input.isLastTrainingFailed,
    text: () => '上一次重训失败了，这里用的是更早那一次成功训练的工件。',
  },
  {
    id: 'retrained',
    intent: 'info',
    when: (input) => input.isModelRetrained,
    text: () => '模型已完成重训，点「重新取数并推荐」用新工件重算。',
  },
  {
    id: 'edited',
    intent: 'warning',
    when: (input) => input.resultEdited,
    text: () => '结果基于手动调整过的读数，不是当前实时工况。',
  },
  {
    id: 'blind',
    intent: 'warning',
    when: (input) => input.resultBlind,
    text: () =>
      '这次没有任何实时读数，结果只反映时段、季节与组合本身，不含当前温湿度。',
  },
  {
    id: 'stale',
    intent: 'warning',
    when: (input) => input.staleCount > 0,
    text: (input) =>
      `有 ${input.staleCount} 台的最新读数已经是 ${input.staleMinutes} 分钟前的了，结果可能反映不了当下。`,
  },
  {
    id: 'missing',
    intent: 'info',
    when: (input) => input.missingCount > 0 && !input.allMissing,
    text: (input) =>
      `${input.missingCount} 台机组窗内没有读数，它们的条件按未知处理。`,
  },
]

/**
 * 该出现的提示，按固定次序。
 * @param input 判定所需的事实
 */
export function liveTestNotices(input: LiveNoticeInput): LiveNotice[] {
  return NOTICE_RULES.filter((rule) => rule.when(input)).map((rule) => ({
    id: rule.id,
    intent: rule.intent,
    text: rule.text(input),
  }))
}
