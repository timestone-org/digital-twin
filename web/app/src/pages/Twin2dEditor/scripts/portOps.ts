/**
 * @fileoverview 节点层的纯算术：端口点（世界坐标 + 朝向）、四档旋转的吸档、一次拖动
 * 落到哪。几何转手给 `@dt/twin2d`、吸附转手给 `snapping.ts`，本文件只做编排。
 *
 * ⚠ 端口的世界坐标只走 `portWorldPos`：它管着 rotate × flip 的复合顺序，另算一份在
 * 对称符号上肉眼看不出差别，在二极管上就是极性反了——图画得挺好，接线是错的。
 * ⚠ 旋转只有 0/90/180/270 四档：任意角度会让正交走线失去意义、端口吸附点变成无理数。
 */
import {
  TWIN_2D_NODE_ROTATIONS,
  finiteOr,
  oneOf,
  portWorldPos,
  portWorldSide,
  uniqueBy,
} from '@dt/twin2d'
import type {
  Pt,
  Twin2dNode,
  Twin2dNodeRotation,
  Twin2dNodeStyle,
  Twin2dSide,
} from '@dt/twin2d'

import { nodeSnapBox } from './entityBoxes'
import { snapNodeBox } from './snapping'
import type {
  Twin2dGuideLine,
  Twin2dSnapBox,
  Twin2dSnapOptions,
} from './snapping'

/** 拼端口点的键用；取一个 id 里出不来的控制字符。 */
const KEY_SEP = '\u0000'

/** 一整圈的度数。 */
const FULL_TURN = 360

/** 一档旋转的度数。 */
const TURN_STEP = 90

/** 弧度 → 度。 */
const DEG_PER_RAD = 180 / Math.PI

/** 一条参考线都没命中；不每次现造一个空表，免得下游白重画。 */
const NO_GUIDES: readonly Twin2dGuideLine[] = Object.freeze([])

/** 画布上的一个端口点。 */
export interface Twin2dPortDot {
  /** ⚠ 端口 id 只在节点内唯一，跨节点的键必须带上节点 id。 */
  key: string
  nodeId: string
  portId: string
  /** 引脚名（1 / A / GND），挂在这个点的 `title` 上。 */
  name: string
  /** 世界坐标（设计像素）。 */
  at: Pt
  /** 出线方向，跟着节点的旋转与镜像一起转。 */
  side: Twin2dSide
}

/** 拖动中的那一批。 */
export interface Twin2dNodeDrag {
  /** 一起挪的节点。 */
  ids: readonly string[]
  /**
   * 吸附只按它算，其余节点原样加同一个差值。
   * ⚠ 逐个各吸各的会让一批节点在拖动中散开。
   */
  leadId: string
  dx: number
  dy: number
}

/** 一次拖动的落位与这一帧要画的参考线。 */
export interface Twin2dNodeMove {
  /** 落位后的整份节点表；一步都没挪时**原样返回入参那个引用**。 */
  nodes: readonly Twin2dNode[]
  guides: readonly Twin2dGuideLine[]
}

/**
 * 一个节点上生效的端口点。
 * ⚠ 节点上的同 id 端口覆盖样式里的那一个，与 `portWorldPos` 的解析同序；反过来的
 * 表现是「改了引脚位置，画出来的点没动，线却挂到别处去了」。
 * @param node 节点实例
 * @param style 该节点用的样式
 */
export function nodePortDots(
  node: Twin2dNode,
  style: Twin2dNodeStyle,
): readonly Twin2dPortDot[] {
  const dots: Twin2dPortDot[] = []
  for (const port of uniqueBy(
    [...node.ports, ...style.ports],
    (entry) => entry.id,
  )) {
    const at = portWorldPos(node, style, port.id)
    // 端口就是从这两张表里来的，寻不到只可能是上面那行改错了；不让 null 漏进坐标
    if (at === null) continue
    dots.push({
      key: `${node.id}${KEY_SEP}${port.id}`,
      nodeId: node.id,
      portId: port.id,
      name: port.name,
      at,
      side: portWorldSide(node, style, port.id),
    })
  }
  return dots
}

/**
 * 吸到最近的一档旋转。
 * ⚠ 与归一化那一份的口径不同：那边把非法值一律判成 0（手误输入的 45 不该被圆成
 * 90），这里吃的是手势扫过的连续角度，最近的一档就是用户要的那一档。
 * @param deg 任意角度（度）
 */
export function snapRotation(deg: number): Twin2dNodeRotation {
  const wrapped = ((finiteOr(deg, 0) % FULL_TURN) + FULL_TURN) % FULL_TURN
  const turn = (Math.round(wrapped / TURN_STEP) * TURN_STEP) % FULL_TURN
  // 白名单一律借归一化那一份，本文件不另写一条「四档之外怎么办」
  return oneOf(turn, TWIN_2D_NODE_ROTATIONS, 0)
}

/**
 * 一次旋转手势落到哪一档：指针绕节点中心扫过的角度加到起手那一档上。
 * ⚠ 用扫过的角而不是「指针指向哪就转到哪」：手柄跟着节点一起转，绝对角在起手那一下
 * 就会把节点弹到另一档，镜像过的节点尤其明显。
 * @param base 起手时节点的档位
 * @param center 节点中心（世界坐标）
 * @param from 起手点（世界坐标）
 * @param to 当前点（世界坐标）
 */
export function rotationOf(
  base: Twin2dNodeRotation,
  center: Pt,
  from: Pt,
  to: Pt,
): Twin2dNodeRotation {
  const swept =
    Math.atan2(to.y - center.y, to.x - center.x) -
    Math.atan2(from.y - center.y, from.x - center.x)
  return snapRotation(base + swept * DEG_PER_RAD)
}

/**
 * 换掉一个节点的档位；档位没变或节点不在就原样返回入参那个引用。
 * ⚠ 同一个引用是调用方判「这一手势要不要落一步撤销」的依据：转回原档再松手不该
 * 在撤销栈上留一格空步。
 * @param nodes 整份节点表
 * @param id 要转的节点
 * @param rotate 目标档位
 */
export function withNodeRotation(
  nodes: readonly Twin2dNode[],
  id: string,
  rotate: Twin2dNodeRotation,
): readonly Twin2dNode[] {
  const target = nodes.find((node) => node.id === id)
  if (target === undefined || target.rotate === rotate) return nodes
  return nodes.map((node) => (node.id === id ? { ...node, rotate } : node))
}

/**
 * 可以被吸的那些盒。
 * ⚠ 正在拖的那一批必须排掉，否则它会吸住自己——表现是「怎么拖都不动」。
 * @param nodes 整份节点表
 * @param styles 按 id 取节点样式（文档 ∪ 预置库，调用方合并好）
 * @param moving 正在拖的那一批
 */
function peerBoxes(
  nodes: readonly Twin2dNode[],
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
  moving: ReadonlySet<string>,
): Twin2dSnapBox[] {
  const boxes: Twin2dSnapBox[] = []
  for (const node of nodes) {
    const style = styles.get(node.styleId)
    if (moving.has(node.id) || style === undefined) continue
    boxes.push(nodeSnapBox(node, style))
  }
  return boxes
}

/**
 * 一次拖动落到哪：主选中吸网格与同级边线，其余节点原样加同一个差值。
 * @param nodes 整份节点表
 * @param styles 按 id 取节点样式（文档 ∪ 预置库，调用方合并好）
 * @param drag 这一帧的位移与被拖的那一批
 * @param snap 吸附配置（`threshold` 已换算成设计像素）
 */
export function moveNodes(
  nodes: readonly Twin2dNode[],
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
  drag: Twin2dNodeDrag,
  snap: Twin2dSnapOptions,
): Twin2dNodeMove {
  const moving = new Set(drag.ids)
  const lead = nodes.find((node) => node.id === drag.leadId)
  const style = lead === undefined ? undefined : styles.get(lead.styleId)
  // 主选中的样式悬空时整批不动：这种节点在画面上本来就没有盒
  if (lead === undefined || style === undefined) {
    return { nodes, guides: NO_GUIDES }
  }
  const box = nodeSnapBox(lead, style)
  const hit = snapNodeBox(
    {
      ...box,
      x: box.x + finiteOr(drag.dx, 0),
      y: box.y + finiteOr(drag.dy, 0),
    },
    peerBoxes(nodes, styles, moving),
    snap,
  )
  const dx = hit.x - box.x
  const dy = hit.y - box.y
  if (dx === 0 && dy === 0) return { nodes, guides: hit.guides }
  return {
    nodes: nodes.map((node) =>
      moving.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
    ),
    guides: hit.guides,
  }
}
