/**
 * @fileoverview 摆放坐标的两套基准之间的换算。纯算术，不依赖 three，也不改配置。
 *
 * 落库的坐标永远是世界坐标，基准只决定「0 在哪」：`model` 把 0 放在模型自己的
 * 坐标系原点上，`center` 把前后左右的 0 挪到模型全部模块的正中心，高度轴不动。
 *
 * ⚠ 基准只平移不旋转：三条轴始终与世界轴同向。让它跟着 `model.rotation` 转的话，
 * 输入框成了模型系而视口里的坐标轴手柄仍是世界系，同一个「X 加 1」在两处往两个
 * 方向走，而两处都不报错。
 */
import type { TwinCoordFrame, Vec3 } from './types'

/** 模型的世界水平跨度；高度轴不参与居中，故只要两条水平轴的上下界。 */
export interface TwinHorizontalSpan {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function midpoint(low: number, high: number): number {
  return (low + high) / 2
}

/**
 * 当前基准的原点，世界坐标。
 *
 * ⚠ 选了 `center` 但模型还没装载（`span` 为 null）时退回模型原点：没有模型就没有
 * 中心，编一个出来会让全部读数在模型装载的那一刻整片跳一次。
 *
 * @param frame 基准
 * @param modelOrigin 模型原点在世界里的位置（即 `model.position`）
 * @param span 模型的世界水平跨度；没有模型或包围盒为空时传 null
 */
export function twinFrameOrigin(
  frame: TwinCoordFrame,
  modelOrigin: Vec3,
  span: TwinHorizontalSpan | null,
): Vec3 {
  const fallback: Vec3 = [modelOrigin[0], modelOrigin[1], modelOrigin[2]]
  if (frame === 'model' || span === null) return fallback
  const x = midpoint(span.minX, span.maxX)
  const z = midpoint(span.minZ, span.maxZ)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fallback
  // 高度轴与模型坐标系一致：只有前后左右挪到中心
  return [x, modelOrigin[1], z]
}

/** 世界坐标 → 基准读数。 */
export function toFrameCoords(world: Vec3, origin: Vec3): Vec3 {
  return [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]]
}

/** 基准读数 → 世界坐标（`toFrameCoords` 的逆）。 */
export function toWorldCoords(local: Vec3, origin: Vec3): Vec3 {
  return [local[0] + origin[0], local[1] + origin[1], local[2] + origin[2]]
}

/** 两个三元组逐位相等；基准原点变没变靠它判，免得每帧白发一次回调。 */
export function sameVec3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}
