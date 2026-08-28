/**
 * @fileoverview 调色板 → 画布拖放那半张契约：dataTransfer 用哪个类型、载荷装什么，
 * 以及松手那一点落成节点位置之前要过的三道算术。
 * 拖出的一侧（`NodePalette.vue`）与接住的一侧（`EditorCanvas.vue`）各写一份字面量的
 * 话，改一处就悄悄拖不出东西来——拖到画布上什么都不发生，且零报错。
 */
import { clamp } from '@dt/twin2d'
import type { Pt, Twin2dCanvas, Twin2dNodeSize } from '@dt/twin2d'

import { snapPoint } from './snapping'
import type { Twin2dSnapOptions } from './snapping'

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
