/**
 * @fileoverview 开机事件页的呈现规则：结局的中文说法、组合覆盖度排序、
 * 达标时长的显示，以及下钻曲线取哪一段。都是纯函数，与 Vue 无关。
 */
import type {
  CombinationCoverage,
  SourceRange,
  DtIntent,
  DtSelectOption,
  StartupBatch,
  StartupEpisode,
} from '@dt/contracts'
import { STARTUP_OUTCOMES } from '@dt/contracts'

import { formatDateTime } from '@/utils/datetime'

/**
 * 结局的中文说法。
 * ⚠ 丢弃原因与「可用」一样要显示：它们说明数据为什么少，藏起来等于把
 * 「抽取规则把大半样本判掉了」这件事一起藏了。
 */
const OUTCOME_LABELS: Record<string, string> = {
  usable: '可用',
  set_changed: '中途改了组合',
  timeout: '超时未达标',
  data_gap: '数据有缺口',
}

const OUTCOME_INTENTS: Record<string, DtIntent> = {
  usable: 'success',
  set_changed: 'warning',
  timeout: 'warning',
  data_gap: 'danger',
}

// 未达标事件画到哪：与 §3 的 100 分钟上限同值，只用于取图，不是判定规则
const TIMEOUT_MINUTES = 100
// 曲线前后各多留一点，好看清起始那一下与达标那一刻
const CURVE_PAD_MINUTES = 10
const MINUTE_MS = 60_000

/** 结局的中文说法；后端出了目录外的新值就原样显示，不吞掉。 */
export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome
}

export function outcomeIntent(outcome: string): DtIntent {
  return OUTCOME_INTENTS[outcome] ?? 'neutral'
}

/** 结局筛选器的选项，含「全部」。 */
export function outcomeOptions(): DtSelectOption[] {
  return [
    { value: '', label: '全部结果' },
    ...STARTUP_OUTCOMES.map((value) => ({ value, label: outcomeLabel(value) })),
  ]
}

/** 运行组合的显示：序号用顿号连起来；空组合说清是空的。 */
export function formatRunningSet(serials: readonly string[]): string {
  return serials.length === 0 ? '（无）' : serials.join('、')
}

/**
 * 达标时长的显示。
 * ⚠ **0 要显示成 0 分钟**——风机一起来房间就已经在范围内，实测占三成多。
 * 写成 `minutes || '—'` 会把这三成静默显示成「没达标」。
 * @param minutes 达标时长，null 表示没达标
 */
export function formatDuration(minutes: number | null): string {
  return minutes === null ? '—' : `${minutes} 分钟`
}

/** 覆盖度按可用条数从多到少排；同数的按组合名稳定排。 */
export function sortedCoverage(
  items: readonly CombinationCoverage[],
): CombinationCoverage[] {
  return [...items].sort((left, right) => {
    if (left.usable_count !== right.usable_count) {
      return right.usable_count - left.usable_count
    }
    return formatRunningSet(left.running_set).localeCompare(
      formatRunningSet(right.running_set),
    )
  })
}

// 低于这个条数的组合另标一下：样本太少，训练出来的结论不可信
export const THIN_THRESHOLD = 20

// 一页事件的条数。翻页是替换不是追加，所以它同时就是 DOM 里的行数上限
export const EPISODE_PAGE_SIZE = 20

export interface CoverageRow {
  /** 传给运行组合筛选器的取值，与 `combinationOptions` 同一口径。 */
  value: string
  label: string
  count: number
  /** 组内最多的那个条数，条形按它取比例。 */
  max: number
  isThin: boolean
}

/**
 * 覆盖度摊成左栏的行：条形按组内最大值取比例，一眼看得出哪三四个组合占了绝大多数。
 * ⚠ `max` 至少为 1：一条都还没攒到时按 0 去除会得到 NaN，整排条形静默消失。
 * @param items 当前批次的组合覆盖度
 */
export function coverageRows(
  items: readonly CombinationCoverage[],
): CoverageRow[] {
  const rows = sortedCoverage(items)
  const max = Math.max(1, ...rows.map((item) => item.usable_count))
  return rows.map((item) => ({
    value: item.running_set.join(','),
    label: formatRunningSet(item.running_set),
    count: item.usable_count,
    max,
    isThin: item.usable_count < THIN_THRESHOLD,
  }))
}

/** 运行组合筛选器的选项，取自覆盖度——那就是实际出现过的组合。 */
export function combinationOptions(
  items: readonly CombinationCoverage[],
): DtSelectOption[] {
  return [
    { value: '', label: '全部组合' },
    ...sortedCoverage(items).map((item) => ({
      value: item.running_set.join(','),
      label: `${formatRunningSet(item.running_set)}（${item.usable_count}）`,
    })),
  ]
}

/**
 * 下钻曲线取哪一段：起始前 10 分钟到达标后 10 分钟。
 * ⚠ 没达标的事件没有 `complied_at`，退到起始 + 100 分钟——那是判超时的上限，
 * 正好覆盖到它被判掉的那一刻。
 * @param episode 要看的那次开机
 */
export function curveWindow(episode: StartupEpisode): {
  from: string
  to: string
} {
  const started = Date.parse(episode.started_at)
  const ended =
    episode.complied_at === null
      ? started + TIMEOUT_MINUTES * MINUTE_MS
      : Date.parse(episode.complied_at)
  return {
    from: new Date(started - CURVE_PAD_MINUTES * MINUTE_MS).toISOString(),
    to: new Date(ended + CURVE_PAD_MINUTES * MINUTE_MS).toISOString(),
  }
}

/** 批次进度的百分比；分片总数为 0 时算 0，不做除零。 */
export function batchProgress(batch: StartupBatch): number {
  if (batch.shard_total <= 0) return 0
  return Math.round((batch.shard_done / batch.shard_total) * 100)
}

/** 批次覆盖的时间窗，给人看的那一行。 */
export function formatWindow(batch: StartupBatch): string {
  return `${formatDateTime(batch.window_start)} — ${formatDateTime(batch.window_end)}`
}

// 分片按「房间 + 月」切，所以跨几个月就是几片（§5）
const DAYS_PER_MONTH = 30.44
const DAY_MS = 86_400_000

/**
 * 抽取区间是否可以提交；不行时给一句能显示的原因。
 * ⚠ 两端都留空是合法的，那表示「全部可用历史」——由后端按数据源实际范围算，
 * 前端不写死任何日期。只填一端也合法，另一端同样交给后端。
 * @param range 当前填的区间
 */
export function rebuildRangeProblem(range: {
  from: string
  to: string
}): string | null {
  if (range.from !== '' && range.to !== '' && range.from >= range.to) {
    return '起始时间必须早于结束时间'
  }
  return null
}

/** 有没有指定区间。两端都空就是全部历史。 */
export function isFullHistory(range: { from: string; to: string }): boolean {
  return range.from === '' && range.to === ''
}

/**
 * 这一段大概跨多少个月分片，用来在确认框里说清这次要跑多大。
 * @param range 抽取区间，两端都要有取值才估得出来
 */
export function estimatedShards(range: { from: string; to: string }): number {
  const span = Date.parse(range.to) - Date.parse(range.from)
  if (!Number.isFinite(span) || span <= 0) return 0
  return Math.max(1, Math.ceil(span / DAY_MS / DAYS_PER_MONTH))
}

/**
 * 确认框里那句话：抽哪一段、大概几片。
 * ⚠ 没填区间时按 `source` 给的实际范围来估——那才是「全部历史」的真实跨度，
 * 前端不猜、也不写死任何日期。
 * @param range 抽取区间
 * @param source 数据源里实际有数据的那一段，取不到时为 null
 */
export function describeRebuild(
  range: { from: string; to: string },
  source: SourceRange | null,
): string {
  const effective = {
    from: range.from || source?.start || '',
    to: range.to || source?.end || '',
  }
  const tail = '抽完之前，页面继续显示上一批次的结果。'
  if (effective.from === '' || effective.to === '') {
    return `将抽取全部可用历史。${tail}`
  }
  const span = `${formatDateTime(effective.from)} — ${formatDateTime(effective.to)}`
  const shards = estimatedShards(effective)
  return `将抽取 ${span}，约 ${shards} 个月度分片。${tail}`
}

/** 数据源实际有数据的那一段，说给用户听。 */
export function describeSourceRange(source: SourceRange | null): string {
  if (source === null) return ''
  return `数据源现有 ${formatDateTime(source.start)} — ${formatDateTime(source.end)}`
}

export interface EpisodeRow {
  id: string
  started: string
  combination: string
  duration: string
  outcome: string
  intent: DtIntent
  isExcluded: boolean
  reason: string
  episode: StartupEpisode
}

/**
 * 摊成表格行，显示串一次算好。
 * ⚠ 被排除的行照样出现，只是带上标记——让它消失会让人以为自己排掉的那条
 * 从数据里没了（AC_STARTUP_DESIGN §8）。
 * @param episodes 当前这一页的事件
 */
export function toEpisodeRows(
  episodes: readonly StartupEpisode[],
): EpisodeRow[] {
  return episodes.map((episode) => ({
    id: episode.started_at,
    started: formatDateTime(episode.started_at),
    combination: formatRunningSet(episode.running_set),
    duration: formatDuration(episode.duration_minutes),
    outcome: outcomeLabel(episode.outcome),
    intent: outcomeIntent(episode.outcome),
    isExcluded: episode.is_excluded,
    reason: episode.exclusion_reason ?? '',
    episode,
  }))
}
