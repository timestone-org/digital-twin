/**
 * @fileoverview 节点位姿的唯一实现：左上角 ↔ 中心盒换算、根 transform 串、端口在画布
 * 坐标系里的位置与朝向，以及 keepUpright 图元的反向变换。复合顺序写死一条：
 * 先镜像 → 再旋转 → 最后平移。口径见 docs/MODULE_TWIN_2D_DESIGN.md §8、§4.4 与 §4.6。
 */
import { perimeterPoint, resolveSide, sideNormal } from './geometry'
import { TWIN_2D_SIDE_PRIORITY } from './kinds'
import { twin2dOutlinePoint } from './outline'
import type { Box, PerimeterPoint, Pt } from './geometry'
import type { Twin2dNodeRotation, Twin2dSide } from './kinds'
import type {
  Twin2dNode,
  Twin2dNodeSize,
  Twin2dNodeStyle,
  Twin2dOutline,
  Twin2dPort,
  Twin2dPortAt,
} from './types'

/**
 * 四档旋转的 cos 精确值。
 * ⚠ 不走 `Math.cos(deg * Math.PI / 180)`：`Math.cos(Math.PI / 2)` 是 6.1e-17 而不是 0，
 * 每个端口坐标都会带上一串浮点尾巴，断言只能退化成近似比较，而近似比较盖得住
 * 半个像素的真错位。
 */
const TURN_COS: Readonly<Record<Twin2dNodeRotation, number>> = Object.freeze({
  0: 1,
  90: 0,
  180: -1,
  270: 0,
})

/** 四档旋转的 sin 精确值 */
const TURN_SIN: Readonly<Record<Twin2dNodeRotation, number>> = Object.freeze({
  0: 0,
  90: 1,
  180: 0,
  270: -1,
})

/** 一个节点的位姿：旋转的 cos/sin 与两轴镜像因子。 */
interface NodePose {
  deg: Twin2dNodeRotation
  cos: number
  sin: number
  sx: number
  sy: number
}

/**
 * 从节点实例取位姿。
 * ⚠ 根 transform 串与端口坐标**只从这里**读角度与镜像因子：两处各写一遍，复合顺序
 * 迟早会漂，而顺序错在对称符号上肉眼看不出来，在二极管这种非对称符号上就是极性
 * 反了——图画得挺好，接线是错的（§8）。
 */
function poseOf(node: Twin2dNode): NodePose {
  return {
    deg: node.rotate,
    cos: TURN_COS[node.rotate],
    sin: TURN_SIN[node.rotate],
    sx: node.flipX ? -1 : 1,
    sy: node.flipY ? -1 : 1,
  }
}

/** 中心参考的一个位移：先镜像 → 再旋转（§8 的复合顺序，不含平移）。 */
function rotateFlip(x: number, y: number, pose: NodePose): Pt {
  const mx = x * pose.sx
  const my = y * pose.sy
  return {
    x: mx * pose.cos - my * pose.sin,
    y: mx * pose.sin + my * pose.cos,
  }
}

/** `rotateFlip` 的逆：先反旋转 → 再撤镜像（逆矩阵顺序也是反的）。 */
function unrotateUnflip(x: number, y: number, pose: NodePose): Pt {
  const rx = x * pose.cos + y * pose.sin
  const ry = -x * pose.sin + y * pose.cos
  return { x: rx * pose.sx, y: ry * pose.sy }
}

/** 盒内一点 → 变换后的画布坐标。 */
function worldPoint(p: Pt, box: Box, pose: NodePose): Pt {
  const moved = rotateFlip(p.x - box.x, p.y - box.y, pose)
  return { x: box.x + moved.x, y: box.y + moved.y }
}

/**
 * 节点实例（左上角 `x/y` + 宽高）→ 以**中心**为参考的盒。
 * ⚠ 这是两套坐标系之间的唯一接缝：文档里节点的 `x/y` 是左上角，而几何层的盒以中心
 * 为参考。漏掉这一步的表现是全图连线整体偏半个节点，而它看起来像「锚点算错了」（§4.6）。
 * ⚠ `w`/`h` 为 0 是「跟样式的 `size` 走」的哨兵（归一化把 0 与负数一律判为无值），
 * 所以必须拿样式尺寸兜底，不能直接用节点上的数。
 * @param node 节点实例
 * @param size 样式的缺省尺寸，节点自己没给尺寸时用它
 */
export function centerBoxOf(node: Twin2dNode, size: Twin2dNodeSize): Box {
  const w = node.w > 0 ? node.w : size.w
  const h = node.h > 0 ? node.h : size.h
  return { x: node.x + w / 2, y: node.y + h / 2, w, h }
}

/**
 * 节点根元素的 `transform` 值。
 * ⚠ 顺序写死 `translate → rotate → scale`：CSS 的变换列表是从右往左作用到点上的，
 * 所以这一串等价的点变换顺序正是「先镜像 → 再旋转 → 最后平移」，与 `portWorldPos`
 * 同源（§8）。
 * ⚠ 三段恒定输出，不按「没转就省掉 rotate」分叉：`rotate(0deg)` 与 `scale(1, 1)`
 * 都是恒等变换，而串形稳定让检查器与用例都只对一种形状。
 * ⚠ 前提是根元素按 `left: 0 / top: 0` 摆、尺寸就是节点盒、`transform-origin` 用缺省
 * 的中心——三者任一变了，端口坐标就与渲染出来的符号对不上。
 * @param node 节点实例
 */
export function nodeTransformCss(node: Twin2dNode): string {
  const pose = poseOf(node)
  const move = `translate(${node.x}px, ${node.y}px)`
  const turn = `rotate(${pose.deg}deg)`
  const mirror = `scale(${pose.sx}, ${pose.sy})`
  return `${move} ${turn} ${mirror}`
}

/**
 * 未变换的画布坐标点 → 节点变换之后它落在哪。
 * @param p 未变换的点（画布坐标）
 * @param node 节点实例
 * @param size 样式的缺省尺寸
 */
export function applyNodeTransform(
  p: Pt,
  node: Twin2dNode,
  size: Twin2dNodeSize,
): Pt {
  return worldPoint(p, centerBoxOf(node, size), poseOf(node))
}

/**
 * `applyNodeTransform` 的逆：画布上的一点 → 节点未变换时它落在哪。
 * 编辑器命中要用它——指针给的是画布坐标，而图元的矩形是按未变换的盒摆的。
 * @param p 变换后的点（画布坐标）
 * @param node 节点实例
 * @param size 样式的缺省尺寸
 */
export function invertNodeTransform(
  p: Pt,
  node: Twin2dNode,
  size: Twin2dNodeSize,
): Pt {
  const box = centerBoxOf(node, size)
  const back = unrotateUnflip(p.x - box.x, p.y - box.y, poseOf(node))
  return { x: box.x + back.x, y: box.y + back.y }
}

/** 找端口：节点上的同 id 覆盖样式里的那一个，两边都没有 → null。 */
function resolvePort(
  node: Twin2dNode,
  style: Twin2dNodeStyle,
  portId: string,
): Twin2dPort | null {
  const own = node.ports.find((port) => port.id === portId)
  if (own !== undefined) return own
  return style.ports.find((port) => port.id === portId) ?? null
}

/**
 * 端口在节点自己盒里的落点，已投到样式声明的外缘上。
 * ⚠ 周长那一档转手给 `perimeterPoint`，本文件不另写一份参数化：两份的表现是只有下边
 * 与左边的端口左右（上下）镜像、其余两段全对，看图基本发现不了（§8）。
 * ⚠ 投影只往里收（`twin2dOutlinePoint` 的口径），所以摆在符号内部的 `xy` 端口原地不动，
 * 只有贴着外接矩形的那些会被拉到画出来的边上。
 * @param box 节点自己的盒（中心参考）
 * @param at 端口的落点声明
 * @param outline 这份样式的外缘
 */
function portLocalPoint(
  box: Box,
  at: Twin2dPortAt,
  outline: Twin2dOutline,
): Pt {
  const raw: PerimeterPoint =
    at.kind === 'xy'
      ? {
          point: {
            x: box.x - box.w / 2 + box.w * at.x,
            y: box.y - box.h / 2 + box.h * at.y,
          },
          normal: { x: 0, y: 0 },
        }
      : perimeterPoint(box, at.t)
  return twin2dOutlinePoint(box, outline, raw).point
}

/** 轴对齐的单位向量 → 四档朝向。 */
function sideOfDir(dir: Pt): Twin2dSide {
  if (Math.abs(dir.x) > Math.abs(dir.y)) return dir.x > 0 ? 'right' : 'left'
  return dir.y > 0 ? 'bottom' : 'top'
}

/**
 * 端口在**画布坐标系**里的位置；端口寻不到时 null，调用方按「这条线挂不上」处理。
 * 与 `nodeTransformCss` 读同一份位姿，所以引脚永远落在渲染出来的符号上（§8）。
 * @param node 节点实例
 * @param style 该节点用的样式
 * @param portId 端口 id
 */
export function portWorldPos(
  node: Twin2dNode,
  style: Twin2dNodeStyle,
  portId: string,
): Pt | null {
  const port = resolvePort(node, style, portId)
  if (port === null) return null
  const box = centerBoxOf(node, style.size)
  return worldPoint(
    portLocalPoint(box, port.at, style.outline),
    box,
    poseOf(node),
  )
}

/**
 * 端口的出线方向，跟着节点的旋转与镜像一起转。`'auto'` 的解析交给 `resolveSide`——
 * 并列怎么办全仓只有那一处说了算（§4.4）。
 * ⚠ 端口寻不到时回 `TWIN_2D_SIDE_PRIORITY` 的头一档：朝向没有「没有」这一档，正交
 * 路由只吃四档 Side（§4.4）。这个兜底值到不了路由——同一个端口 `portWorldPos` 已经
 * 回了 null，那条线本来就挂不上。
 * @param node 节点实例
 * @param style 该节点用的样式
 * @param portId 端口 id
 */
export function portWorldSide(
  node: Twin2dNode,
  style: Twin2dNodeStyle,
  portId: string,
): Twin2dSide {
  const port = resolvePort(node, style, portId)
  if (port === null) return TWIN_2D_SIDE_PRIORITY[0]
  const box = centerBoxOf(node, style.size)
  const dir = sideNormal(resolveSide(box, port.side, port.at))
  return sideOfDir(rotateFlip(dir.x, dir.y, poseOf(node)))
}

/**
 * `keepUpright` 图元的反向变换：把节点根上的旋转与镜像逐一撤掉，让这一枚图元
 * （电路图的元件标号）在任何位姿下都正着读。无可撤的时候回 `'none'`。
 * ⚠ 逆变换的串是 `scale · rotate(-θ)` 而不是 `rotate(-θ) · scale`：顺序反了，在
 * 「转 90°/270° 且只镜一轴」的组合上两者差 180°，标号是倒着的（§8）。
 * ⚠ 只是反向那一段，与图元自己的 `rotate` / `transformOrigin` 怎么合成是 paintCommon
 * 的事。
 * @param node 节点实例
 */
export function keepUprightCss(node: Twin2dNode): string {
  const pose = poseOf(node)
  if (pose.deg === 0 && pose.sx === 1 && pose.sy === 1) return 'none'
  return `scale(${pose.sx}, ${pose.sy}) rotate(${-pose.deg}deg)`
}
