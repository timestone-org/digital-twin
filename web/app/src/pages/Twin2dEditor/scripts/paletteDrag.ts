/**
 * @fileoverview 调色板 → 画布拖放那半张契约：dataTransfer 用哪个类型、载荷装什么，
 * 以及松手那一点落成节点位置之前要过的三道算术。
 * 拖出的一侧（`NodePalette.vue`）与接住的一侧（`EditorCanvas.vue`）各写一份字面量的
 * 话，改一处就悄悄拖不出东西来——拖到画布上什么都不发生，且零报错。
 */
import { clamp } from '@dt/twin2d'
import type {
  Pt,
  Twin2dCanvas,
  Twin2dConfig,
  Twin2dNode,
  Twin2dNodeSize,
  Twin2dNodeStyle,
} from '@dt/twin2d'

import { addNode } from './nodeOps'
import type { Twin2dAdded } from './nodeOps'
import { TWIN_2D_DEFAULT_SNAP, snapPoint } from './snapping'
import type { Twin2dSnapOptions } from './snapping'
import { twin2dNodeStyleOf } from './styleOps'

/**
 * 载荷是节点样式 id。
 * ⚠ 用自定义 MIME 而不是 `text/plain`：后者会让从别处拖进来的任意文本都被当成一次
 * 「新建节点」尝试，而落地的会是一个样式悬空、整个画不出来的节点。
 */
export const TWIN_2D_STYLE_DRAG_MIME = 'application/x-twin2d-style-id'

/**
 * 松手那一点落成的节点位置（左上角，与 `Twin2dNode.x/y` 同口径）：先把盒摆到指针
 * 正中，再吸网格，最后整只盒夹进画布。
 * ⚠ 摆正中这一步不能省：`x/y` 是**左上角**，直接拿指针当 `x/y` 的话，节点会整体落在
 * 光标的右下方，符号越大偏得越远——而那看起来像「拖放不准」。
 * ⚠ 顺序是「先吸后夹」：反过来的话，贴边那一手会被吸回画布外半格，而节点跨在边线上
 * 意味着大屏上只看得见它的一半。
 * ⚠ 夹的是整只盒不是那个点：画布四周那圈留白照样收得下这一手，落在外面的节点在大屏
 * 上整个看不见——表现是「拖下去什么都没出现」，与「拖放坏了」分不开。
 * @param at 松手那一点（设计坐标）
 * @param size 这份样式的缺省尺寸
 * @param canvas 画布尺寸
 * @param snap 这一帧生效的吸附配置
 */
export function twin2dDropPoint(
  at: Pt,
  size: Twin2dNodeSize,
  canvas: Twin2dCanvas,
  snap: Twin2dSnapOptions,
): Pt {
  const corner = { x: at.x - size.w / 2, y: at.y - size.h / 2 }
  const snapped = snapPoint(corner, snap)
  return {
    x: clamp(snapped.x, 0, Math.max(0, canvas.width - size.w)),
    y: clamp(snapped.y, 0, Math.max(0, canvas.height - size.h)),
  }
}

/**
 * 调色板上点一下：在画布正中加一个节点，与拖下来那一手过同样三道算术。
 * ⚠ 不能拿画布中心直接当 `x/y`：那是左上角，节点会整个落在中心右下方，也不在网格上。
 * ⚠ 样式解析不到就一个都不加，理由同 `addNode` 交回的 `id: null`。
 * @param config 当前配置
 * @param styleId 点的那份样式
 */
export function addNodeAtCenter(
  config: Twin2dConfig,
  styleId: string,
): Twin2dAdded {
  const style = twin2dNodeStyleOf(config, styleId)
  if (style === null) return { config, id: null }
  const { canvas } = config
  const center = { x: canvas.width / 2, y: canvas.height / 2 }
  const snap = { ...TWIN_2D_DEFAULT_SNAP, grid: canvas.grid }
  const where = twin2dDropPoint(center, style.size, canvas, snap)
  return addNode(config, twin2dNodeSeed(style, where))
}

/** 只画显示名的那一类样式（文字标注）的分栏。 */
const TEXT_ONLY_CATEGORY = 'label'

/**
 * 从调色板落一个新节点的种子：样式、位置，文字标注那一类再带上起手文字。
 * ⚠ 文字标注只画显示名：空着落下去就只剩一根 3px 的竖条，看不出加了什么。
 * @param style 落下去的那份样式
 * @param at 左上角（设计坐标）
 */
export function twin2dNodeSeed(
  style: Twin2dNodeStyle,
  at: Pt,
): Partial<Omit<Twin2dNode, 'id'>> {
  const seed = { styleId: style.id, x: at.x, y: at.y }
  return style.category === TEXT_ONLY_CATEGORY
    ? { ...seed, label: style.name }
    : seed
}
