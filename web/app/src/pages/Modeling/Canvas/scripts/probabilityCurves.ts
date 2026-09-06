/**
 * @fileoverview ROC / PR / 校准三条曲线的取料：把后端算好的点列折成散点元件的
 * curve 态要的序列、参考线与两条轴名（结果展示规格 §13.3）。
 *
 * ⚠ 一个数都不在这里算：曲线由后端在**全部**不同概率值上算，前端手上只有抽样
 * 过的那几十档，拿它现算的 AUC 与同屏指标卡对不上账，同屏两个数打架比没有这张
 * 图更坏。这里只做「哪个键画到哪根轴上」。
 * ⚠ 三条曲线的参考几何各不相同：ROC 与校准是对角线，PR 是正类占比那条横线。
 */
import type { CurveKind, ProbabilityItem } from './reportBlocks'
import { breakdownOf, probabilityItemsOf } from './reportBlocks'
import type { ScatterRule, ScatterSeries } from './scatterGeometry'

type Item = Record<string, unknown>

/** 阈值网格归 `thresholdGrid.ts`，这里只画三条曲线。 */
export type DrawnCurve = Exclude<CurveKind, 'grid'>

/** 一条曲线摆出来的样子，组件里不再做判断。 */
export interface CurveView {
  series: ScatterSeries[]
  rules: ScatterRule[]
  xLabel: string
  yLabel: string
  /** 对角线：ROC 是随机基准、校准是完美校准；PR 不画。 */
  diagonal: boolean
  /** 图下补的那一句：抽样、空心、以及画不出来的那几档。 */
  note: string
}

/** 三条曲线各自的轴名与序列名。 */
const AXES: Record<DrawnCurve, { x: string; y: string; name: string }> = {
  roc: { x: '假正率', y: '真正率', name: 'ROC' },
  pr: { x: '召回率', y: '精确率', name: 'PR' },
  calibration: { x: '平均预测概率', y: '实际正类率', name: '校准' },
}

/** 点少于这个数才连点带线画；再多点会糊成一条粗带。 */
const DOTTED_POINTS = 20

/** 一条曲线上的一个点：两个坐标 + 这一点可不可信。 */
interface Spot {
  x: number
  y: number
  isHollow: boolean
}

/** 这一项在这条曲线上的两个坐标；有一个读不出来就不画这一点。Args: item, kind。 */
function spotOf(item: ProbabilityItem, kind: DrawnCurve): Spot | null {
  const pair =
    kind === 'roc'
      ? [item.fpr, item.tpr]
      : kind === 'pr'
        ? [item.recall, item.precision]
        : [item.predicted, item.actual]
  const [x, y] = pair
  if (x === null || x === undefined || y === null || y === undefined) {
    return null
  }
  return { x, y, isHollow: kind === 'calibration' && item.isSparse }
}

/**
 * 画不出来的那几档照实说。
 *
 * ⚠ 不许闷声少画几个点：PR 曲线上「一行都没判成正类」那几档的精确率是无定义
 * 不是 0，补一个 0 会在图上多出一段贴着底边的假塌陷。
 * Args: kind, missing 没画出来的档数。
 */
function missingText(kind: DrawnCurve, missing: number): string {
  if (missing === 0) return ''
  if (kind === 'pr') {
    return `有 ${missing} 档一行都没判成正类，精确率无定义，这几档没画`
  }
  return `有 ${missing} 档的坐标算不出来，没画`
}

/** 空心那几个点的口径。Args: hollow 空心几个；total 一共几个。 */
function hollowText(hollow: number, total: number): string {
  if (hollow === 0) return ''
  return `${total} 个箱里有 ${hollow} 个不足十行，画成空心——那几档的实际正类率抖得读不出校准`
}

/** 图下补的那一句。Args: kind, spots, missing。 */
function noteOf(
  kind: DrawnCurve,
  spots: readonly Spot[],
  missing: number,
): string {
  const hollow = spots.filter((spot) => spot.isHollow).length
  const lines = [
    kind === 'calibration'
      ? hollowText(hollow, spots.length)
      : `每个点是一个阈值：越往右上角，判成正类的门槛越低`,
    missingText(kind, missing),
  ]
  return lines.filter((line) => line !== '').join('；')
}

/**
 * PR 那条基线：正类占比。
 *
 * ⚠ 只有 PR 有基线：一个「全押正类」的模型精确率恰好等于正类占比，曲线压在这条
 * 线上就说明它什么也没学到——而 ROC 的同一件事是那条对角线。
 * Args: payload, kind。
 */
function rulesOf(payload: Item, kind: DrawnCurve): ScatterRule[] {
  if (kind !== 'pr') return []
  const base = breakdownOf(payload).baseline
  if (base === null) return []
  return [{ at: base, label: '正类占比', intent: 'reference' }]
}

/**
 * 一条曲线折成散点元件要的那几样。
 *
 * Args: payload 这一块的 payload；kind 三条曲线中的哪一条。
 */
export function buildCurve(payload: Item, kind: DrawnCurve): CurveView {
  const items = probabilityItemsOf(payload)
  const spots: Spot[] = []
  for (const item of items) {
    const spot = spotOf(item, kind)
    if (spot !== null) spots.push(spot)
  }
  const axes = AXES[kind]
  return {
    series: [
      {
        name: axes.name,
        points: spots.map((spot) => [spot.x, spot.y] as const),
        hollow: spots.map((spot) => spot.isHollow),
        draw: spots.length > DOTTED_POINTS ? 'line' : 'both',
      },
    ],
    rules: rulesOf(payload, kind),
    xLabel: axes.x,
    yLabel: axes.y,
    diagonal: kind !== 'pr',
    note: noteOf(kind, spots, items.length - spots.length),
  }
}
