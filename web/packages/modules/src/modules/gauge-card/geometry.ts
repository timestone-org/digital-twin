/**
 * @fileoverview gauge-card 的几何与量程数学：极坐标转直角、描弧、量程 → 百分比 → 填充。
 * 五档形状共用这一条链，只在最后一步分叉成弧的 dashoffset、条的宽度或液面的高度
 * （MODULE_INFO_CARD_DESIGN §4.2）。纯函数，不碰 DOM。
 * ⚠ 全程按**百分比 0–100** 传递，不用 0–1 的比例：CSS 的 width / left / height 都要百分号，
 * 两套单位混着走时 0.42 与 42 都「是个数」，画出来只是位置不对，谁也不报错。
 * ⚠ 量程非法（`min >= max`）一律给 `null` 而不是 0 或 NaN：伪造出来的 0% 在墙上是
 * 「有数据的错误读数」，比空着更难发现。
 * ⚠ 填充比例夹在 [0,100]，完成率不夹——完成率可以显 >100%，视觉宽度另用夹过的那个数。
 */
import { isPresent } from '../../shared/format'

import {
  GAUGE_SHAPE_THICKNESS,
  GAUGE_THICKNESS_MAX,
  GAUGE_THICKNESS_MIN,
  type GaugeShape,
} from './options'

/** 弧上的一个点，SVG 用户坐标。 */
export interface GaugePoint {
  x: number
  y: number
}

/** 一段弧的起止角，正上方为 0°、顺时针递增；`end` 可以大于 360。 */
export interface GaugeArcAngles {
  start: number
  end: number
}

/** 贴边标签的对齐基准：`translateX` 的取值，三档而不是一个数。 */
export type GaugeLabelShift = '0' | '-50%' | '-100%'

/** 弧的画布边长：`viewBox="0 0 100 100"`，改它必须同步改模板里那串。 */
export const GAUGE_ARC_BOX = 100

/** 弧的圆心，画布正中。 */
export const GAUGE_ARC_CENTER = GAUGE_ARC_BOX / 2

/**
 * 弧的 `pathLength`：把任意长度的弧归一成 100，填充直接用
 * `stroke-dasharray="100"` + `stroke-dashoffset = 100 − 百分比`，不必先量真实弧长。
 */
export const GAUGE_ARC_PATH_LENGTH = 100

/** 弧的张角区间与缺省（270° = 底部留 90° 缺口，逐字取自参考仓的 225°→495°）。 */
export const GAUGE_ARC_SPAN_MIN = 180
export const GAUGE_ARC_SPAN_MAX = 300
export const GAUGE_ARC_SPAN_DEFAULT = 270

/** 刻度个数的区间与缺省（参考仓 target-progress 写死 4 个等距刻度）。 */
export const GAUGE_TICK_COUNT_MIN = 2
export const GAUGE_TICK_COUNT_MAX = 8
export const GAUGE_TICK_COUNT_DEFAULT = 4

/** 描边外缘与画布边之间留的一格，让最粗的描边也不被 viewBox 裁掉。 */
const ARC_EDGE_PAD = 1

/** 贴边判定：离两端这么多百分点以内就换对齐基准（参考仓 target 标签的 0.02）。 */
const EDGE_PERCENT = 2

/** 弧上取点保留的小数位，够画且让 `d` 串稳定。 */
const PATH_DIGITS = 3

/** 非有限数一律当没配、回落 `fallback`，其余钳进 [low, high]。 */
function clampFinite(
  value: number,
  low: number,
  high: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(high, Math.max(low, value))
}

/** 坐标取整，避免浮点尘埃塞进 `d` 串。 */
function round(value: number): number {
  const scale = 10 ** PATH_DIGITS
  return Math.round(value * scale) / scale
}

/**
 * 缺值、非数与负数一律当 0%，其余钳进 [0,100]——这是画填充用的那个数。
 * @param percent 量程百分比，`null` = 没有读数
 */
export function fillPercent(percent: number | null): number {
  if (!isPresent(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

/**
 * 这一档填充画不画。
 * ⚠ 真实 0% 必须整条不渲染：只把宽/高设成 0 会在墙上留一小截带辉光的色块
 * （圆角端头 + `box-shadow` 撑出来的），读起来像「有一点点」。
 * @param percent 量程百分比，`null` = 没有读数
 */
export function isFillVisible(percent: number | null): boolean {
  return fillPercent(percent) > 0
}

/**
 * 读数按 [min, max] 归一成百分比，钳在 0–100。
 * ⚠ 目标标记的落点走的也是这一条（`normalizePercent(target, min, max)`），不另开一份。
 * ⚠ 量程非法（含 `min === max` 与 NaN）返回 `null` 而不是把上界改成 `min + 100`：
 * 伪造一段量程会让整卡的百分比全是错的，而屏上看不出来。
 * @param value 读数，缺值或非数即 `null`
 * @param min 量程下界
 * @param max 量程上界
 */
export function normalizePercent(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (!isPresent(value)) return null
  if (!(max > min)) return null
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

/**
 * 完成率 = 值 ÷ 目标 × 100，**不夹**，可以超过 100%。
 * ⚠ 目标缺失或为 0 时退回按量程算的那个百分比，不是返回 0——否则除零会把
 * 「没配目标」显示成「一点没完成」。
 * @param value 读数，缺值或非数即 `null`
 * @param target 目标值，缺值、非数或 0 即退回量程口径
 * @param rangePercent 量程百分比，即 `normalizePercent` 的结果
 */
export function completionPercent(
  value: unknown,
  target: unknown,
  rangePercent: number | null,
): number | null {
  if (!isPresent(value)) return null
  if (isPresent(target) && target !== 0) return (value / target) * 100
  return rangePercent
}

/**
 * 形状 + 配置厚度 → 真正用的像素厚度。
 * ⚠ `0`、负数与非有限数都当「随形状」：属性面板清空那个数字输入框、JSON 里写 `null`、
 * 预设里写 `0`，落库形态各不相同，但意思是同一个。
 * @param shape 五档几何
 * @param thickness 配置里的厚度，`0` = 随形状
 */
export function resolveThickness(shape: GaugeShape, thickness: number): number {
  if (!Number.isFinite(thickness) || thickness <= 0) {
    return GAUGE_SHAPE_THICKNESS[shape]
  }
  return Math.min(GAUGE_THICKNESS_MAX, Math.max(GAUGE_THICKNESS_MIN, thickness))
}

/**
 * 极坐标转直角：`angleDeg` 以正上方为 0°、顺时针递增（SVG 惯例，与数学惯例差 90°）。
 * @param cx 圆心横坐标
 * @param cy 圆心纵坐标
 * @param radius 半径
 * @param angleDeg 角度
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): GaugePoint {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
}

/**
 * 张角 → 起止角，缺口永远在正下方居中（张角 270° 即参考仓的 225°→495°）。
 * @param spanDeg 张角，钳进 [180, 300]，非有限数回落 270
 */
export function arcAngles(spanDeg: number): GaugeArcAngles {
  const span = clampFinite(
    spanDeg,
    GAUGE_ARC_SPAN_MIN,
    GAUGE_ARC_SPAN_MAX,
    GAUGE_ARC_SPAN_DEFAULT,
  )
  const start = 360 - span / 2
  return { start, end: start + span }
}

/**
 * 描边中线的半径：外缘（半径 + 半个描边）刚好不顶到画布边。
 * @param thickness 描边宽度，`0` / 非有限数 = 随形状取缺省
 */
export function arcRadius(thickness: number): number {
  return (
    GAUGE_ARC_CENTER - resolveThickness('arc', thickness) / 2 - ARC_EDGE_PAD
  )
}

/**
 * 生成一段弧的 `d`。
 * ⚠ 大弧标志（`A` 指令的第四个数）必须跟着张角翻：超过 180° 还写 0，SVG 会挑
 * **短的那一边**画——每个数都对，弧却是反的。
 * ⚠ 张角满 360° 时起点与终点重合，一条 `A` 指令画出来是个点（这也是 `arcAngles`
 * 把张角钳到 300° 的原因）。
 * @param cx 圆心横坐标
 * @param cy 圆心纵坐标
 * @param radius 半径
 * @param startAngle 起始角
 * @param endAngle 终止角
 */
export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const from = polarToCartesian(cx, cy, radius, startAngle)
  const to = polarToCartesian(cx, cy, radius, endAngle)
  const sweep = (((endAngle - startAngle) % 360) + 360) % 360
  const largeArc = sweep > 180 ? 1 : 0
  const r = round(radius)
  return `M ${round(from.x)} ${round(from.y)} A ${r} ${r} 0 ${largeArc} 1 ${round(to.x)} ${round(to.y)}`
}

/**
 * 弧度盘那一整条 `d`：圆心固定在画布正中，半径与起止角都由这两个旋钮推出来。
 * @param thickness 描边宽度，`0` = 随形状取缺省
 * @param spanDeg 张角
 */
export function arcPath(thickness: number, spanDeg: number): string {
  const { start, end } = arcAngles(spanDeg)
  return describeArc(
    GAUGE_ARC_CENTER,
    GAUGE_ARC_CENTER,
    arcRadius(thickness),
    start,
    end,
  )
}

/**
 * 弧上某个百分比处的角度，用来把目标标记、指针一类的东西钉到弧上。
 * @param percent 量程百分比，`null` = 起点
 * @param spanDeg 张角
 */
export function arcAngleAt(percent: number | null, spanDeg: number): number {
  const { start, end } = arcAngles(spanDeg)
  return start + ((end - start) * fillPercent(percent)) / 100
}

/** 指针尖离弧内缘留这么远，太贴会看着像戳在弧上。 */
const NEEDLE_TIP_GAP = 6
/** 指针根部半宽；再宽就成了扇形，再窄在缩放后会消失。 */
const NEEDLE_HALF_WIDTH = 2.6

/**
 * 指针的 `d`：一个从圆心指向读数角度的窄三角。
 * ⚠ 尖端**不落在弧上**而是留一段：贴着画时描边的圆头会与指针尖糊成一团，
 * 读者分不清指的是哪一格。
 * @param percent 量程百分比，`null` = 指向起点
 * @param spanDeg 张角
 * @param thickness 弧的描边宽，用来算内缘
 */
export function needlePath(
  percent: number | null,
  spanDeg: number,
  thickness: number,
): string {
  const angle = arcAngleAt(percent, spanDeg)
  const inner =
    arcRadius(thickness) -
    resolveThickness('arc', thickness) / 2 -
    NEEDLE_TIP_GAP
  const c = GAUGE_ARC_CENTER
  const tip = polarToCartesian(c, c, Math.max(0, inner), angle)
  const left = polarToCartesian(c, c, NEEDLE_HALF_WIDTH, angle - 90)
  const right = polarToCartesian(c, c, NEEDLE_HALF_WIDTH, angle + 90)
  return `M ${fmt(left.x)} ${fmt(left.y)} L ${fmt(tip.x)} ${fmt(tip.y)} L ${fmt(right.x)} ${fmt(right.y)} Z`
}

/** SVG 路径里的数留一位小数就够，长串小数只是把 DOM 撑大。 */
function fmt(value: number): string {
  return value.toFixed(1)
}

/**
 * 填充用的 `stroke-dashoffset`：配合 `pathLength="100"`，0% 时整条藏起来。
 * @param percent 量程百分比，`null` = 没有读数即不填
 */
export function arcDashOffset(percent: number | null): number {
  return GAUGE_ARC_PATH_LENGTH - fillPercent(percent)
}

/**
 * 一整段弧的真实长度（用户坐标）。
 * ⚠ 填充用不着它——那一路走 `pathLength` 归一。它是给要按真实长度摆东西的地方用的。
 * @param radius 半径
 * @param spanDeg 张角
 */
export function arcLength(radius: number, spanDeg: number): number {
  const { start, end } = arcAngles(spanDeg)
  return (Math.PI * radius * (end - start)) / 180
}

/**
 * 弧从起点走到某个百分比处的长度。
 * @param radius 半径
 * @param spanDeg 张角
 * @param percent 量程百分比，`null` = 0
 */
export function arcLengthAt(
  radius: number,
  spanDeg: number,
  percent: number | null,
): number {
  return (arcLength(radius, spanDeg) * fillPercent(percent)) / 100
}

/**
 * 等距刻度的落点，首尾各占一个（4 个 → 0 / 33.3 / 66.7 / 100）。
 * ⚠ 至少两个：一个刻度会让分母 `count − 1` 变 0，整排刻度全是 NaN 而模板照画。
 * @param count 刻度个数，钳进 [2, 8]，非有限数回落 4
 */
export function tickPercents(count: number): number[] {
  const total = Math.round(
    clampFinite(
      count,
      GAUGE_TICK_COUNT_MIN,
      GAUGE_TICK_COUNT_MAX,
      GAUGE_TICK_COUNT_DEFAULT,
    ),
  )
  return Array.from(
    { length: total },
    (_, index) => (index / (total - 1)) * 100,
  )
}

/**
 * 贴边标签的对齐基准：居中的那一半会溢出卡片被裁掉，所以首尾两端要换基准。
 * ⚠ 刻度与目标标签共用这一条。参考仓那两处是两套判据（刻度按下标、目标按 2% 阈值），
 * 收成阈值一套；四刻度下逐个结果与参考仓相同。
 * @param percent 标签所在的百分比位置，`null` = 起点
 */
export function labelAnchorShift(percent: number | null): GaugeLabelShift {
  const at = fillPercent(percent)
  if (at <= EDGE_PERCENT) return '0'
  if (at >= 100 - EDGE_PERCENT) return '-100%'
  return '-50%'
}
