/**
 * @fileoverview 进度件的视图模型与它那套 CSS 变量。
 *
 * 「取值 → 视图」与「视图 → 画」在这里分家：算百分比是各模块自己的行/格语义
 * （info-list 有五档来源、卡片部件另有量程档），而**画**是同一件事。不分家就只能
 * 整段抄第二份，抄完两份 CSS 各自漂（MODULE_DATA_CARD_DESIGN §5.1）。
 *
 * ⚠ 变量由**调用方注入**：这里只定名字，`MeterBar.vue` 只认变量不认配置键。
 * 名字拼错既不报错也不生效——`css-variables.contract.spec.ts` 扫不到
 * `packages/modules/src`，唯一的守卫是 `tests/shared/meter.test.ts` 里那条与
 * `MeterBar.vue` 双向吻合的断言。
 */
import type { CSSProperties } from 'vue'

/** 进度件的两档形态。 */
export type MeterKind = 'bar' | 'track'

/** 一条进度条要画的东西。⚠ 已经是算完的结果，`MeterBar` 不再做任何取值判断。 */
export interface MeterView {
  /** 画不画这一条。 */
  show: boolean
  /** 条前面那个小字，空串 = 不画。 */
  label: string
  /** 「xx%」读数；关掉读数或算不出时是空串 / 占位符。 */
  text: string
  /**
   * 填充宽度，形如 `'42.0%'`；空串 = 整条填充不渲染。
   * ⚠ 宽度由取值层夹到 [0,100] 而占比读数**不夹**：120% 正是要让人看见的那个异常
   * （MODULE_INFO_CARD_DESIGN §4.2）。
   */
  fill: string
}

/** 粗轨道那一档的量程：刻度、目标标记与轨道内 pill 都从它来。 */
export interface MeterScale {
  min: number
  max: number
  /** 目标标记的原值；`null` = 不画标记 */
  target: number | null
  targetLabel: string
  /** 「万」格式；⚠ `max` 不到一万时整件回落，小量程走万会让刻度全塌成「0.0万」 */
  wanFormat: boolean
  /** ⚠ 刻度与 pill 共用这一份小数位：参考仓刻度写死 1 位而 pill 另有一档，同一张卡两套口径 */
  wanDigits: number
  /** pill 读数的小数位；刻度一律取整 */
  precision: number
  /** 轨道内 pill 的读数原值；`null` = 不画 pill */
  pillValue: number | null
  pillUnit: string
}

/**
 * 进度件从外面读的那几个变量。
 * ⚠ `--dt-meter-base` 是「跟随行 / 格色」那一级回落，多半由调用方的样式表顺着级联给
 * （info-list 的 `_row.scss` 就是），而不是由某个 `look.ts` 逐条注入——两种给法都算。
 */
export type MeterVarName =
  | '--dt-meter-h'
  | '--dt-meter-w'
  | '--dt-meter-color'
  | '--dt-meter-base'
  | '--dt-meter-glow'

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const METER_VAR_NAMES: readonly MeterVarName[] = [
  '--dt-meter-h',
  '--dt-meter-w',
  '--dt-meter-color',
  '--dt-meter-base',
  '--dt-meter-glow',
]

/**
 * 调用方注入的那只袋子。
 * ⚠ 「没配 = 不写键」：颜色与辉光注入了就再也回落不到样式表里的档位缺省。
 */
export type MeterVars = CSSProperties & Partial<Record<MeterVarName, string>>
