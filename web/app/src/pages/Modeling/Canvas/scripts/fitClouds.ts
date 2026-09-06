/**
 * @fileoverview 「模型内部长什么样」那一块里的散点图算料：后端逐点给的一张图
 * 折成散点件要的形状。
 *
 * ⚠ 画法认 `mode` 不认标题：残差图要一条零线、真值对预测要一条理想对角线，两者
 * 共用一副点位形状而参考几何不同——认标题的话，改一个字整张图的参照物就没了。
 * ⚠ 认不出的画法整张不画，不退回默认那一档：默认那一档会给残差图配上一条
 * 「理想线」，而残差图上根本没有这条线的意思（规格 §2-P4）。
 */
import type {
  ScatterMode,
  ScatterPoint,
  ScatterSeries,
} from './scatterGeometry'
import { recordOf } from './reportBlocks'

type Item = Record<string, unknown>

/** 走这条路来的两种画法。⚠ 与后端 `linearreport.py` 的 `Cloud.mode` 逐字对齐。 */
const CLOUD_MODES = ['pairs', 'residual'] as const

type CloudMode = (typeof CLOUD_MODES)[number]

/** 一张散点图折出来的样子，组件里不再做判断。 */
export interface CloudPanel {
  readonly key: string
  readonly mode: ScatterMode
  readonly xLabel: string
  readonly yLabel: string
  readonly series: readonly ScatterSeries[]
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isCloudMode(value: string): value is CloudMode {
  return CLOUD_MODES.some((mode) => mode === value)
}

/** 一串 `[x, y]`。⚠ 两个数缺一个就整点不要：补 0 会在轴上落一个假点。 */
function pointsOf(value: unknown): ScatterPoint[] {
  const kept: ScatterPoint[] = []
  for (const one of Array.isArray(value) ? value : []) {
    const pair: unknown[] = Array.isArray(one) ? one : []
    const [x, y] = pair
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    kept.push([x, y])
  }
  return kept
}

/**
 * 这一块上的几张散点图。
 *
 * Args: payload。
 */
export function cloudPanels(payload: Item): CloudPanel[] {
  const raw = payload['clouds']
  const made: CloudPanel[] = []
  for (const [seat, one] of (Array.isArray(raw) ? raw : []).entries()) {
    const item = recordOf(one)
    const mode = textOf(item['mode'])
    const points = pointsOf(item['points'])
    if (!isCloudMode(mode) || points.length === 0) continue
    made.push({
      key: `${seat}:${textOf(item['key'])}`,
      mode,
      xLabel: textOf(item['x_label']),
      yLabel: textOf(item['y_label']),
      series: [{ name: textOf(item['name']), points, draw: 'dots' }],
    })
  }
  return made
}
