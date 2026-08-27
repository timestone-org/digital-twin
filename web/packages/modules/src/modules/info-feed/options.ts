/**
 * @fileoverview info-feed 的取值表：行分隔线与时间落点两组档位，外加内置级别档表
 * （MODULE_INFO_CARD_DESIGN §4.3）。
 * ⚠ 清单与渲染**共用这一份**。各抄一份的话，加一档必然有一边漏，表现是面板能选、
 * 渲染静默回落默认档——「选了没反应」最常见的来源。
 */
import type { ConfigOption } from '@dt/contracts'

import {
  levelColor,
  SEVERITY_RANK,
  THRESHOLD_LEVELS,
  type ThresholdLevel,
} from '../../shared/thresholds'

/** 取值数组：`readEnum` 的白名单直接从选项表推，不再手抄一遍。 */
function valuesOf<T extends string>(
  options: readonly { value: T; label: string }[],
): readonly T[] {
  return options.map((option) => option.value)
}

/** 行分隔线的线型。 */
export const FEED_BORDER_STYLES = [
  { value: 'dotted', label: '点线' },
  { value: 'dashed', label: '虚线' },
  { value: 'solid', label: '实线' },
  { value: 'none', label: '无' },
] as const satisfies readonly ConfigOption[]

export type FeedBorderStyle = (typeof FEED_BORDER_STYLES)[number]['value']
export const FEED_BORDER_STYLE_VALUES = valuesOf(FEED_BORDER_STYLES)

/** 时间摆在行的哪一头。正文永远吃掉中间的空档，时间贴着它的另一侧。 */
export const FEED_TIME_PLACES = [
  { value: 'right', label: '行尾' },
  { value: 'left', label: '行首' },
] as const satisfies readonly ConfigOption[]

export type FeedTimePlace = (typeof FEED_TIME_PLACES)[number]['value']
export const FEED_TIME_PLACE_VALUES = valuesOf(FEED_TIME_PLACES)

/** 一档级别的呈现方式：颜色（主题变量或用户色）+ 文字标记 + 排序权重。 */
export interface FeedLevelStyle {
  /** 空串 = 不注入颜色变量，由样式表的中性缺省接管。 */
  color: string
  /** 空串 = 不画级别文字。 */
  label: string
  rank: number
}

/**
 * 未识别级别：不注入颜色、不画文字、排在全部内置档之下。
 * ⚠ 不伪装成某一档状态——推来一个认不出的词，屏上就该是中性的。
 */
export const FEED_UNKNOWN_LEVEL: FeedLevelStyle = {
  color: '',
  label: '',
  rank: 0,
}

/**
 * 内置档画在圆点旁的四个词。
 * ⚠ 与 `info-list` 的 `LEVEL_TEXT`（正常 / 提示 / 警告 / **危急**）以及
 * `shared/thresholds.ts` 的 `LEVEL_OPTIONS`（下拉项，写成「危险（红）」）都不是一套。
 * 三份词表各服务一处画面，改任何一份都不要顺手同步另外两份。
 */
export const FEED_LEVEL_LABELS: Record<ThresholdLevel, string> = {
  normal: '正常',
  info: '提示',
  warning: '警告',
  danger: '危险',
}

/**
 * 每一档严重度吃得下的级别词。
 * ⚠ `red` / `yellow` / `blue` / `green` 这一组是为「以颜色词表达级别」的推送数据准备的。
 * ⚠ 气象「橙色」**刻意没有内置映射**：主题里的状态色只有成功 / 提示 / 警告 / 危险四支
 * （`themeEngine.ts` 的 `TOKEN_CSS_VAR` 是全集），橙没有对应语义色。顺手映到
 * `--state-warning` 会让橙与黄两档在屏上同色，五色预警当场塌成四色；要精确的橙必须在
 * `levels` 里配一个颜色。代码里零颜色字面量。
 */
export const FEED_LEVEL_ALIASES: Record<ThresholdLevel, readonly string[]> = {
  danger: ['danger', 'red', 'error'],
  warning: ['warning', 'warn', 'yellow'],
  info: ['info', 'blue'],
  normal: ['success', 'normal', 'green'],
}

/**
 * 内置档的排序权重比 `SEVERITY_RANK` 整体高一档：0 号让给未识别级别，
 * 它必须排在「正常」之下，而不是与「正常」并列打平。
 */
function builtinRank(level: ThresholdLevel): number {
  return SEVERITY_RANK[level] + 1
}

function buildBuiltinLevels(): Record<string, FeedLevelStyle> {
  const table: Record<string, FeedLevelStyle> = {}
  for (const level of THRESHOLD_LEVELS) {
    const style: FeedLevelStyle = {
      // 颜色从共用的严重度色表来：同屏的告警列表与信息流同色，换肤也一起跟着走
      color: levelColor(level),
      label: FEED_LEVEL_LABELS[level],
      rank: builtinRank(level),
    }
    for (const key of FEED_LEVEL_ALIASES[level]) table[key] = style
  }
  return table
}

/**
 * 内置级别档：11 个级别词映到四支主题状态色。
 * ⚠ 键是归一化（trim + 小写）之后的级别词，查表前两侧都要先归一。
 */
export const FEED_BUILTIN_LEVELS: Record<string, FeedLevelStyle> =
  buildBuiltinLevels()
