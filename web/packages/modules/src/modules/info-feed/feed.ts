/**
 * @fileoverview info-feed 的行数据组装：把绑定推来的 `{level, text, time}` 直通成一行要画的
 * 东西（级别色、级别文字、正文、时刻），再按级别权重排一次序。
 *
 * ⚠ **直通渲染，不做阈值评估也不做数值格式化**：`level` 只用来着色与排序，`time` 是后端推的
 * 成品文本而不是墙钟（对比 `info-list`：那个才是客户端按规则表评估数值点位的）。
 * ⚠ 行数由推送数组的长度决定，配置里没有对应的行清单——这正是本模块与另外三个卡片模块
 * 分家的理由（MODULE_INFO_CARD_DESIGN §1.2）。
 */
import type { CSSProperties } from 'vue'

import {
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readTrimmedText,
} from '../../shared/config'
import { NO_DATA } from '../../shared/format'

import {
  FEED_BUILTIN_LEVELS,
  FEED_UNKNOWN_LEVEL,
  type FeedLevelStyle,
} from './options'

/**
 * 信息流条目的数组绑定槽键。
 * ⚠ 清单与渲染两处都从这里取，不许各写一遍字面量：拼错的那一份既不报错也永远取不到值。
 */
export const FEED_SLOT_KEY = 'feedValues'

/**
 * 一条信息的三个子槽。
 * ⚠ 清单的 `arrayFields` 必须照这一份摆：子槽键的漂移**没有任何闸门看着**
 * （「绑定槽键两侧逐一对上」那条只比顶层槽键），清单写 `msg`、这里读 `text`
 * 的表现是整列正文恒为空，零报错。
 */
export const FEED_SLOT_FIELDS = ['level', 'text', 'time'] as const

type IfRowVarName = '--if-level-color'

/** 逐行注入的 CSS 变量；样式表只认变量，不认级别词。 */
export type FeedRowVars = CSSProperties & Partial<Record<IfRowVarName, string>>

/** 逐行变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IF_ROW_VAR_NAMES: readonly IfRowVarName[] = ['--if-level-color']

/** 一条信息要画的全部东西。 */
export interface FeedRowView {
  /** `v-for` 的键：到达位次 + 这一条的内容，按级别重排时同一条的键不变。 */
  key: string
  /** 在推送数组里的位次，排序时用它做同权重的稳定 tiebreak。 */
  index: number
  /** 归一化后的级别词；空串 = 这一条没推级别。 */
  level: string
  /** 级别文字标记；空串 = 不画（未识别级别不编造文字）。 */
  label: string
  /** 正文；后端没推正文时是「—」，不留空行。 */
  text: string
  /**
   * 联动上抛的值 = 后端推来的原始正文；空串 = 这一条点了不上抛。
   * ⚠ 与 `text` 分开是必须的：直接上抛 `text` 会把占位符「—」当成一个真值发出去，
   * 下游的筛选联动于是被设成「—」，两边都不报错。
   */
  pickValue: string
  /** 时刻文本，后端直通；空串 = 这一条不占时刻位。 */
  time: string
  rank: number
  /** ⚠ 没有颜色的级别**不写这个键**：注入空串就落不回样式表里的中性缺省。 */
  vars: FeedRowVars
}

/** 组装一条信息流要用到的输入。 */
export interface FeedRowsInput {
  config: Record<string, unknown>
  /** `values[FEED_SLOT_KEY]` 的原值，正常是一个行数组。 */
  rows: unknown
}

/** 级别色板里的一行配置。 */
interface LevelRow {
  key: string
  style: FeedLevelStyle
}

/**
 * 级别值归一：去首尾空白 + 转小写。
 * ⚠ 两侧都要归一：后端推 `'WARNING'` / `' Red '` 是常态，配置里的 key 也是手打的。
 * @param raw 级别词的原值
 */
function normKey(raw: unknown): string {
  return readTrimmedText(raw).toLowerCase()
}

/**
 * 色板里的一行 → 一档级别。
 * ⚠ 「配了一半」不该把颜色打回中性：只填了文字或权重的条目，其余项仍回落内置档。
 * @param raw 色板数组里的一行
 */
function toLevelRow(raw: unknown): LevelRow | null {
  const row = readRecord(raw)
  const key = normKey(row.key)
  if (key === '') return null
  const builtin = FEED_BUILTIN_LEVELS[key] ?? FEED_UNKNOWN_LEVEL
  return {
    key,
    style: {
      color: readTrimmedText(row.color) || builtin.color,
      label: readTrimmedText(row.label) || builtin.label,
      rank: readNumber(row.rank, builtin.rank),
    },
  }
}

/**
 * 内置档 + 用户色板合成的查找表。
 * ⚠ 同 key 后配置的覆盖先配置的（末条生效，与属性面板从上往下读的直觉一致）。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
export function readFeedLevels(
  config: Record<string, unknown>,
): Record<string, FeedLevelStyle> {
  const table: Record<string, FeedLevelStyle> = { ...FEED_BUILTIN_LEVELS }
  for (const raw of readArray(config.levels)) {
    const row = toLevelRow(raw)
    if (row !== null) table[row.key] = row.style
  }
  return table
}

/**
 * 一条推送 → 一行。
 * ⚠ 三个子槽全空的条目**整条跳过**：数组槽新增了行却还没选点、或后端这一轮没推这一条时，
 * `values` 里就是个空对象，画出来是一串空白行——大屏上比缺行更难看也更不诚实。
 * @param raw 推送数组里的一条
 * @param index 在推送数组里的位次
 * @param levels 级别查找表
 */
function toRow(
  raw: unknown,
  index: number,
  levels: Record<string, FeedLevelStyle>,
): FeedRowView | null {
  const record = readRecord(raw)
  const level = normKey(record.level)
  const text = readTrimmedText(record.text)
  const time = readTrimmedText(record.time)
  if (level === '' && text === '' && time === '') return null
  const style = levels[level] ?? FEED_UNKNOWN_LEVEL
  return {
    key: `${String(index)}|${level}|${text}`,
    index,
    level,
    label: style.label,
    // 只缺正文（有级别或时刻）的条目照样上墙，正文位显「—」
    text: text === '' ? NO_DATA : text,
    pickValue: text,
    time,
    rank: style.rank,
    vars: style.color === '' ? {} : { '--if-level-color': style.color },
  }
}

/**
 * 推送数组 → 全部要画的行，已按当前排序档排好。
 * ⚠ 缺省保持推送顺序（直通语义）；开了「按级别排序」才按权重降序，
 * 同权重按到达序（显式带位次做 tiebreak，不指望引擎的稳定排序实现）。
 * @param input 配置与推送数组
 */
export function buildFeedRows(input: FeedRowsInput): FeedRowView[] {
  const levels = readFeedLevels(input.config)
  const rows: FeedRowView[] = []
  let index = 0
  for (const raw of readArray(input.rows)) {
    const row = toRow(raw, index, levels)
    index += 1
    if (row !== null) rows.push(row)
  }
  if (!readBoolean(input.config.sortByRank)) return rows
  return rows.sort((a, b) => b.rank - a.rank || a.index - b.index)
}

/**
 * 一条都没有时那一句话。
 * ⚠ 通用文案：本模块除预警外也用于公告 / 日志，故不写死「暂无预警信息」。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
export function readFeedEmptyText(config: Record<string, unknown>): string {
  return readTrimmedText(config.emptyText) || '暂无信息'
}
