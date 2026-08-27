/**
 * @fileoverview 元素套距离规则时的基准点：信息牌落在哪、能量流的中点在哪。
 * 运行态逐帧判显隐用它，编辑器右栏「量当前距离」也用它。
 *
 * ⚠ 两处各算一遍必然漂，而漂了的表现只是「量出来的数填进去不生效」——
 * 既不报错，也没有任何别的痕迹。
 */
import type { TwinAnchor, TwinFlowLink, TwinPanel, Vec3 } from '@dt/twin-config'
import * as THREE from 'three'

/** 相邻两点近到这个距离以内就当成同一个点 */
const MIN_SEGMENT = 1e-6
/** 曲线参数上的中点 */
const MIDPOINT_T = 0.5

/**
 * 信息牌的落点：锚点优先，锚点悬空时退回自带坐标，再叠偏移。
 * ⚠ 退回而不是不画：一张配好了字段的牌因为锚点被删就整个消失，用户只会觉得
 * 「我的牌哪去了」。悬空引用由 `collectTwinConfigIssues` 单独报出来。
 * @param panel 归一化后的信息牌
 * @param anchors 归一化后的锚点，用来解析 `anchorId`
 */
export function panelPositionOf(
  panel: TwinPanel,
  anchors: readonly TwinAnchor[],
): Vec3 {
  const anchor =
    panel.anchorId === ''
      ? undefined
      : anchors.find((item) => item.id === panel.anchorId)
  const base = anchor?.position ?? panel.position
  return [
    base[0] + panel.offset[0],
    base[1] + panel.offset[1],
    base[2] + panel.offset[2],
  ]
}

/**
 * 能量流路径上解析得出的途经点。
 *
 * ⚠ 悬空的锚点引用只跳过那一个点，不废掉整条流——悬空引用由
 * `collectTwinConfigIssues` 单独报出来，渲染层不替它报警。
 * ⚠ 连着的重合点必须并成一个：CatmullRom 在重合点上切线是零向量，
 * TubeGeometry 归一化它会写出 NaN 顶点，那根管线会整根从画面上消失。
 * @param flow 归一化后的能量流
 * @param anchorById 锚点 id → 锚点
 */
export function flowPathPointsOf(
  flow: TwinFlowLink,
  anchorById: ReadonlyMap<string, TwinAnchor>,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (const anchorId of flow.pathAnchors) {
    const anchor = anchorById.get(anchorId)
    if (anchor === undefined) continue
    const point = new THREE.Vector3(...anchor.position)
    const last = points[points.length - 1]
    if (last !== undefined && last.distanceTo(point) <= MIN_SEGMENT) continue
    points.push(point)
  }
  return points
}

/**
 * 路径曲线的中点。一条流没有单一坐标，`self` 参考系按它算距离。
 * @param curve 铺管线用的那条曲线
 */
export function curveMidpoint(curve: THREE.CatmullRomCurve3): THREE.Vector3 {
  return curve.getPointAt(MIDPOINT_T)
}

/**
 * 一条能量流的落点；途经点不足两个时给 null——那条流本来就画不出线。
 * @param flow 归一化后的能量流
 * @param anchors 归一化后的锚点，用来解析 `pathAnchors`
 */
export function flowMidpointOf(
  flow: TwinFlowLink,
  anchors: readonly TwinAnchor[],
): THREE.Vector3 | null {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  const points = flowPathPointsOf(flow, byId)
  if (points.length < 2) return null
  return curveMidpoint(new THREE.CatmullRomCurve3(points))
}
