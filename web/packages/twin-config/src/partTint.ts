/**
 * @fileoverview 部件外观的派生：配置 + 这一刻的实时值 → 该染什么色、多透明。
 * 无 Vue、无 three、无 DOM——运行态渲染器与编辑视口共用同一份，各写一份必漂。
 *
 * ⚠ 档位**自上而下取第一个命中的**：区间重叠时靠顺序定胜负。这里绝不重排、
 * 也不合并重叠档，重排会让用户在界面上调好的优先级在渲染时变成另一个结果。
 * ⚠ 取不到数时一律走 `fallback`，不留在上一次命中的颜色上：留着的话点位掉线
 * 后部件仍是那个颜色，而屏幕上没有任何迹象说明它已经是陈旧的。
 */
import { clamp, finiteValue, toFiniteNumber, trimmedString } from './sanitize'
import type {
  TwinPart,
  TwinPartAppearance,
  TwinPartColor,
  TwinPartTint,
  TwinTintStop,
} from './types'

/** 不染色。共用一个冻结实例，下游按引用比对时不会每帧都判成「变了」。 */
const NO_COLOR: TwinPartColor = Object.freeze({ kind: 'none' })

/**
 * 配了状态染色的部件，按文档序。
 * ⚠ 派生绑定行与缝合读值都必须走这一支：一边按 `config.parts`、另一边按过滤后的
 * 序号时，给中间某个部件关掉染色会让它之后的每一行改喂前一个部件——读数照常刷新，
 * 只是全都接错了对象。
 * @param parts 归一化后的部件
 */
export function tintedParts(parts: readonly TwinPart[]): TwinPart[] {
  return parts.filter((part) => part.tint !== null)
}

/** 颜色规格 → 取色结果；空串即「不额外染色」。 */
function solid(spec: string): TwinPartColor {
  return spec === '' ? NO_COLOR : { kind: 'solid', spec }
}

/**
 * 两个值相等吗。
 * ⚠ 两边都能当数时按数比：点位下发的 `1` 与档位里填的 `"1"` 不按数比就永远对不上，
 * 而界面上两者看起来一模一样。比不了数时按不分大小写的字符串比。
 */
function sameValue(expected: string, value: unknown): boolean {
  const left = toFiniteNumber(expected)
  const right = toFiniteNumber(value)
  if (left !== null && right !== null) return left === right
  const text = typeof value === 'string' ? value.trim() : String(value)
  return text.toLowerCase() === expected.toLowerCase()
}

/** 落在 [from, to) 里吗；两端为 null 即那一侧不设限。 */
function inRange(stop: TwinTintStop, value: unknown): boolean {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return false
  if (stop.from !== null && parsed < stop.from) return false
  return stop.to === null || parsed < stop.to
}

function hits(stop: TwinTintStop, value: unknown): boolean {
  return stop.match === 'equals'
    ? sameValue(stop.equals, value)
    : inRange(stop, value)
}

/** 渐变：值在区间里的位置 [0,1]。⚠ 上下端相等时给 0，不做除零。 */
function gradientPosition(min: number, max: number, value: number): number {
  return max === min ? 0 : clamp((value - min) / (max - min), 0, 1)
}

/**
 * 一条染色规则在这一刻的取色。
 * @param tint 归一化后的染色规则
 * @param value 这个部件的实时值；`undefined` = 取不到数
 */
export function partTintColor(
  tint: TwinPartTint,
  value: unknown,
): TwinPartColor {
  const reading = finiteValue(value)
  if (reading === undefined || reading === null) return solid(tint.fallback)
  if (tint.mode === 'gradient') {
    const parsed = toFiniteNumber(reading)
    if (parsed === null) return solid(tint.fallback)
    const { min, max, from, to } = tint.gradient
    return { kind: 'mix', from, to, t: gradientPosition(min, max, parsed) }
  }
  const stop = tint.stops.find((item) => hits(item, reading))
  return stop === undefined ? solid(tint.fallback) : solid(stop.color)
}

/**
 * 一个部件这一刻的完整外观：状态染色命中就用它的色，否则退回常态色。
 * @param part 归一化后的部件
 * @param value 这个部件的实时值；`undefined` = 取不到数
 */
export function partAppearance(
  part: TwinPart,
  value: unknown,
): TwinPartAppearance {
  const { look } = part
  const tinted = part.tint === null ? NO_COLOR : partTintColor(part.tint, value)
  return {
    opacity: look.opacity,
    color: tinted.kind === 'none' ? solid(look.color) : tinted,
    blend: look.blend,
    glow: look.glow,
  }
}

/**
 * 一档在图例上显示的文字：配了说明就用说明，否则按条件拼一句。
 * ⚠ 拼出来的那句是给人核对用的，必须与 `hits` 的口径逐字一致（含上界不含）。
 * @param stop 归一化后的档位
 */
export function tintStopText(stop: TwinTintStop): string {
  const label = trimmedString(stop.label)
  if (label !== '') return label
  if (stop.match === 'equals') return `= ${stop.equals}`
  if (stop.from === null && stop.to === null) return '任意数值'
  if (stop.to === null) return `≥ ${stop.from}`
  if (stop.from === null) return `< ${stop.to}`
  return `${stop.from} ~ ${stop.to}`
}
