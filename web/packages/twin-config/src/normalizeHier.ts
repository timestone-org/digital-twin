/**
 * @fileoverview 层级钻取节点的归一化：父子指针、同级次序、取景快照与读数字段。
 *
 * ⚠ 字段的实时值走**数组绑定按文档序对齐**，所以这里产出的顺序就是取值的行号。
 * 拖着改父子或调同级次序都不动文档序，只有增删节点与增删字段会推着行号走。
 */
import { normalizePanelField } from './normalizeElements'
import {
  clampedOr,
  entityId,
  normalizeList,
  vec3,
  ORIGIN,
} from './normalizeShared'
import {
  DEFAULT_CAMERA_FOV,
  MAX_CAMERA_FOV,
  MIN_CAMERA_FOV,
} from './normalizeScene'
import { isRecord, stringList, trimmedString } from './sanitize'
import type { TwinHierNode, TwinModalView } from './types'

/** 同级次序的取值区间；超出只说明手滑，夹回来不影响相对先后。 */
const MIN_ORDER = -100000
const MAX_ORDER = 100000

/**
 * 取景快照；不是对象就当没配。
 * ⚠ 视野落到 0 或 180 时取景距离的公式会除零或塌缩，表现是「钻进去画面整个
 * 消失」而不报错，所以这里按视点同一套区间夹住。
 */
function normalizeModalView(raw: unknown): TwinModalView | null {
  if (!isRecord(raw)) return null
  return {
    position: vec3(raw.position, ORIGIN),
    target: vec3(raw.target, ORIGIN),
    fov: clampedOr(raw.fov, DEFAULT_CAMERA_FOV, MIN_CAMERA_FOV, MAX_CAMERA_FOV),
  }
}

/** 父指针：空白视同没有父，也就是一个根。 */
function parentOf(raw: unknown): string | null {
  const id = trimmedString(raw)
  return id === '' ? null : id
}

/**
 * 一个钻取节点。
 * @param raw 落库的节点
 * @param index 文档序下标，缺 id 时按它铸一个
 */
export function normalizeHierNode(
  raw: unknown,
  index: number,
): TwinHierNode | null {
  if (!isRecord(raw)) return null
  return {
    id: entityId(raw.id, 'hier', index),
    parentId: parentOf(raw.parentId),
    name: trimmedString(raw.name),
    order: clampedOr(raw.order, index, MIN_ORDER, MAX_ORDER),
    icon: trimmedString(raw.icon),
    nodes: stringList(raw.nodes),
    view: normalizeModalView(raw.view),
    cameraId: trimmedString(raw.cameraId),
    fields: normalizeList(raw.fields, normalizePanelField),
    summaryFieldKeys: stringList(raw.summaryFieldKeys),
    title: trimmedString(raw.title),
    hideChildList: raw.hideChildList === true,
  }
}
