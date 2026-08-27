/**
 * @fileoverview info-feed 的配置 → 形态：一次读完外观那一半 config，收成一份 `FeedLook`
 * （修饰类、`--if-*` 变量、解析后的数值与三个画不画的开关）。纯函数，模板只摆件不判档位。
 * ⚠ 数值一律夹回清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的 `-8` 会让整条
 * CSS 声明被浏览器丢掉，而 `0` 字号会让正文彻底看不见。
 */
import type { CSSProperties } from 'vue'

import { readBoolean, readEnum, readNumber } from '../../shared/config'

import {
  FEED_BORDER_STYLE_VALUES,
  FEED_TIME_PLACE_VALUES,
  type FeedBorderStyle,
  type FeedTimePlace,
} from './options'

/** 一个尺寸旋钮在属性面板上声明的区间与缺省，`look` 这一层照它再夹一次。 */
interface SizeBound {
  min: number
  max: number
  fallback: number
}

/**
 * 七个尺寸旋钮的区间与缺省。
 * ⚠ 与清单里那七个字段的 `min` / `max` / `default` 逐字相同：两处漂了的表现是
 * 「面板拉得到、渲染夹回去」，属性面板上的数字与墙上的观感对不上。
 */
export const FEED_SIZE_BOUNDS = {
  dotSize: { min: 4, max: 24, fallback: 8 },
  dotGlow: { min: 0, max: 24, fallback: 6 },
  levelSize: { min: 10, max: 32, fallback: 12 },
  timeSize: { min: 10, max: 32, fallback: 12 },
  textSize: { min: 10, max: 32, fallback: 13 },
  rowPadX: { min: 0, max: 24, fallback: 4 },
  rowPadY: { min: 0, max: 24, fallback: 7 },
} as const satisfies Record<string, SizeBound>

type IfVarName =
  | '--if-dot-size'
  | '--if-dot-glow'
  | '--if-level-size'
  | '--if-time-size'
  | '--if-text-size'
  | '--if-row-px'
  | '--if-row-py'

/**
 * 本模块自己的一组 CSS 变量；样式表只认变量，不认配置键。
 * ⚠ 这套变量没有全局闸看着（`css-variables.contract.spec.ts` 扫不到 `packages/modules/src`），
 * 拼错既不报错也不生效，只能靠 `look.test.ts` 里那条与 scss 双向吻合的断言。
 */
export type FeedVars = CSSProperties & Partial<Record<IfVarName, string>>

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const IF_VAR_NAMES: readonly IfVarName[] = [
  '--if-dot-size',
  '--if-dot-glow',
  '--if-level-size',
  '--if-time-size',
  '--if-text-size',
  '--if-row-px',
  '--if-row-py',
]

/** 解析并夹取之后的尺寸；断言尺寸时读这一份而不是解析 px 串。 */
export type FeedNums = Record<keyof typeof FEED_SIZE_BOUNDS, number>

/** 三个「这一件画不画」的开关，模板据此判有没有内容，不判档位名。 */
export interface FeedShow {
  dot: boolean
  /** ⚠ 关掉它就只剩色相在表达级别，色觉障碍与远看的人读不出来。 */
  level: boolean
  time: boolean
}

/** 一条信息流从配置里读出来的全部形态。 */
export interface FeedLook {
  classes: string[]
  vars: FeedVars
  nums: FeedNums
  show: FeedShow
  borderStyle: FeedBorderStyle
  timePlace: FeedTimePlace
}

/**
 * 读一个尺寸旋钮：非有限数回落缺省，越界夹回区间，小数取整。
 * @param raw 配置里读出来的原值
 * @param bound 这个旋钮的区间与缺省
 */
function size(raw: unknown, bound: SizeBound): number {
  const value = Math.round(readNumber(raw, bound.fallback))
  return Math.min(bound.max, Math.max(bound.min, value))
}

/**
 * 解析并夹取全部尺寸。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
function readNums(config: Record<string, unknown>): FeedNums {
  const bounds = FEED_SIZE_BOUNDS
  return {
    dotSize: size(config.dotSize, bounds.dotSize),
    dotGlow: size(config.dotGlow, bounds.dotGlow),
    levelSize: size(config.levelSize, bounds.levelSize),
    timeSize: size(config.timeSize, bounds.timeSize),
    textSize: size(config.textSize, bounds.textSize),
    rowPadX: size(config.rowPadX, bounds.rowPadX),
    rowPadY: size(config.rowPadY, bounds.rowPadY),
  }
}

/**
 * 摊出这一块的 CSS 变量。
 * ⚠ 七个键**一个不缺地全注入**（辉光取 0 时也注入）：样式表那一侧的 `var(--x, 兜底)`
 * 写的是字段缺省，少注入一个就等于把用户关掉的辉光又打开了。
 * 「没配 = 不写键」那条铁律管的是逐行的级别色（见 `feed.ts`），不是这七个恒有值的尺寸。
 * @param nums 已夹取的尺寸
 */
function cssVars(nums: FeedNums): FeedVars {
  return {
    '--if-dot-size': `${nums.dotSize}px`,
    '--if-dot-glow': `${nums.dotGlow}px`,
    '--if-level-size': `${nums.levelSize}px`,
    '--if-time-size': `${nums.timeSize}px`,
    '--if-text-size': `${nums.textSize}px`,
    '--if-row-px': `${nums.rowPadX}px`,
    '--if-row-py': `${nums.rowPadY}px`,
  }
}

/**
 * 读一条信息流的形态。
 * @param config 该节点落库的配置（已铺清单缺省）
 */
export function readFeedLook(config: Record<string, unknown>): FeedLook {
  const nums = readNums(config)
  const borderStyle = readEnum(
    config.rowBorderStyle,
    FEED_BORDER_STYLE_VALUES,
    'dotted',
  )
  const timePlace = readEnum(config.timePlace, FEED_TIME_PLACE_VALUES, 'right')
  return {
    classes: [`if--border-${borderStyle}`, `if--time-${timePlace}`],
    vars: cssVars(nums),
    nums,
    show: {
      dot: readBoolean(config.showDot, true),
      level: readBoolean(config.showLevel, true),
      time: readBoolean(config.showTime, true),
    },
    borderStyle,
    timePlace,
  }
}
