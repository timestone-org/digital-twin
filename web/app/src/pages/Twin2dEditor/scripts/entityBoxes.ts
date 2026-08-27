/**
 * @fileoverview 三类实体在画布上占的那只轴对齐盒：节点（含四档旋转）、标注、一条
 * 折线的外接盒。吸附、框选与把手三处都按它算，几何本身一律借 `@dt/twin2d`。
 *
 * ⚠ 这是编辑器里**唯一**一份「节点的世界盒」：连线两端解析、拖动吸附与框选命中三处
 * 各算一份的话，转过 90° 的节点会在某几处对、另几处偏半个身位，而三处单看都画得对。
 * ⚠ 节点盒有两种参考点，别混用：`nodeWorldBox` 以**中心**为参考（几何层的口径），
 * `nodeSnapBox` 以**左上角**为参考（`Twin2dNode` 与吸附的口径）。混了的表现是整体
 * 偏半个身位，而它看起来像「吸附点算错了」。
 */
import { centerBoxOf } from '@dt/twin2d'
import type {
  Box,
  Pt,
  Twin2dMark,
  Twin2dNode,
  Twin2dNodeStyle,
} from '@dt/twin2d'

import type { Twin2dPickKind } from './editorSelection'
import type { Twin2dSnapBox } from './snapping'

/**
 * 一个可被框中的实体：包围盒按设计坐标给（旋转过的节点给外接盒）。
 * ⚠ 三类共用同一个形状：框选按类分批，而「一批里只有同一类」是选中态的硬口径。
 */
export interface Twin2dEntityBox {
  kind: Twin2dPickKind
  id: string
  box: Twin2dSnapBox
}

/** 转过这两档的节点，画面上占的是换过来的宽高。 */
const QUARTER_TURNS: readonly number[] = [90, 270]

/**
 * 节点在画布上占的那只盒（中心参考）。
 * ⚠ 只交换宽高、不转斜：旋转只有四档 90°，镜像不改盒。
 * @param node 节点实例
 * @param style 该节点用的样式
 */
export function nodeWorldBox(node: Twin2dNode, style: Twin2dNodeStyle): Box {
  const box = centerBoxOf(node, style.size)
  const turned = QUARTER_TURNS.includes(node.rotate)
  return turned ? { x: box.x, y: box.y, w: box.h, h: box.w } : box
}

/**
 * 节点在画布上占的那只盒（左上角参考），吸附与框选按它算。
 * ⚠ 转过 90 / 270 的节点占的是换过来的宽高：按原尺寸吸会吸到一条画面上根本没有的
 * 边上，表现是「明明对齐了，看着还差一截」。
 * @param node 节点实例
 * @param style 该节点用的样式
 */
export function nodeSnapBox(
  node: Twin2dNode,
  style: Twin2dNodeStyle,
): Twin2dSnapBox {
  const box = nodeWorldBox(node, style)
  return { x: box.x - box.w / 2, y: box.y - box.h / 2, w: box.w, h: box.h }
}

/**
 * 一条标注占的那只盒（左上角参考）；辅助线取两端的外接盒。
 * @param mark 标注
 */
export function markSnapBox(mark: Twin2dMark): Twin2dSnapBox {
  if (mark.kind !== 'line') {
    return { x: mark.x, y: mark.y, w: mark.w, h: mark.h }
  }
  return {
    x: Math.min(mark.x, mark.x2),
    y: Math.min(mark.y, mark.y2),
    w: Math.abs(mark.x2 - mark.x),
    h: Math.abs(mark.y2 - mark.y),
  }
}

/**
 * 一串点的外接盒；一个点都没有时 null。
 * ⚠ 连线的框选盒只能这么算：连线自己没有尺寸，它占多大取决于两端解析到哪。
 * @param points 折线点序列
 */
export function pointsBox(points: readonly Pt[]): Twin2dSnapBox | null {
  const first = points[0]
  if (first === undefined) return null
  let minX = first.x
  let maxX = first.x
  let minY = first.y
  let maxY = first.y
  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
