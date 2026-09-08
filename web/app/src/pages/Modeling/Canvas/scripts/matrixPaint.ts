/**
 * @fileoverview 混淆矩阵的上色与定宽两组取值：热力格的透明度档，以及整张表按
 * 列宽之和算出来的表宽（设计规格 §5-21、§7）。
 *
 * ⚠ 两个上限都是全部内置预设逐档实测钉下来的，改之前先按 §7 的口径重量一遍。
 */
import type { MatrixCell } from './matrixStats'
import { grouped, niceNumber } from './numbers'

/** 热力最淡的一档：再淡就看不出这一格有数。 */
const MIN_ALPHA = 0.12

/** 对角格最深的一档：再深就压不住字。 */
const MAX_ALPHA = 0.72

/**
 * 判错格最深的一档。
 * ⚠ 卡在「白字还有 4.5:1」那一档：0.70 时全部内置预设里最低 4.55:1（暗夜紫），0.72 就
 * 掉到 4.39。而压到 0.58 时浅色预设整条错格量程只有 0.192（oklab 欧氏），3% 与
 * 25% 两格只差 0.063 ≈ 3 JND，几格淡粉分不出归属。
 */
const MISS_MAX_ALPHA = 0.7

/**
 * 过了这一档，判对格的字换成压在实心底上的深墨色。
 * ⚠ 只对判对格：判错格铺不到「深墨够 4.5:1」那一带，换了就是把字压进黑白两种
 * 墨都不够的中明度带（暗色预设下 0.45 那一档换深墨只有 2.19:1）。
 */
export const DEEP_ALPHA = 0.45

/** 四种列宽（rem）：行头、每个类目、召回率、支持度。 */
export const TRUTH_WIDTH = 8
export const CLASS_WIDTH = 5.5
export const RECALL_WIDTH = 5.5
export const SUPPORT_WIDTH = 5

/**
 * 一格的热力透明度。深浅铺在已按两把尺子归好的强度上，这里只管两端的取值。
 * @param heat 0–1 的强度，0 表示这一格一行都没有
 * @param isHit 在不在对角线上
 */
export function alphaOf(heat: number, isHit: boolean): number {
  if (heat <= 0) return 0
  const top = isHit ? MAX_ALPHA : MISS_MAX_ALPHA
  return MIN_ALPHA + heat * (top - MIN_ALPHA)
}

/**
 * 整张表的定宽 = 各列宽之和。
 * ⚠ 非写不可：`table-layout: fixed` 在表宽为 auto 时整个不生效，列宽回落成按
 * 内容撑开，长类名当列头时那一列会被拉出两倍宽——而行头那边靠内层 span 的
 * `max-width` 照收，同一张图上就出现两种收口口径。`th` 上的 `max-width` 对表格
 * 单元格根本不管用，只有列宽落到实处才收得住。
 * @param columnCount 类目数
 */
export function boardWidthRem(columnCount: number): number {
  return TRUTH_WIDTH + CLASS_WIDTH * columnCount + RECALL_WIDTH + SUPPORT_WIDTH
}

/**
 * 比率原样写成 0–1 的数，不换算成百分数。
 * ⚠ 乘 100 会把 0.923077 推进 `niceNumber` 的定点档，印出 92.3077% 这种六位有
 * 效数字；比率档走的是四位有效数字，正是这些数该有的位数。
 * @param value 比率，无定义时给 null
 */
export function rate(value: number | null): string {
  return niceNumber(value)
}

/**
 * 一格的读数说明：始终印绝对行数与行内占比——颜色是相对尺子，这两个数才是绝对的。
 * @param cell 这一格
 * @param truth 这一行的真实类目
 * @param guess 这一列判成的类目
 */
export function hintOf(cell: MatrixCell, truth: string, guess: string): string {
  return `真实「${truth}」判成「${guess}」：${grouped(cell.count)} 行，占这一行 ${rate(cell.share)}`
}
