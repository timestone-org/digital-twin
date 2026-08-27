/**
 * @fileoverview 孪生编辑器里「现在选中的是什么」，以及六类实体集合的名字。
 * 大纲树、视口拾取、检查器分派三处共用同一套，各写各的会在「树里选中了 A、
 * 检查器画的是 B」这种地方对不上。
 */
import type {
  TwinAnchor,
  TwinArrow,
  TwinCamera,
  TwinFlowLink,
  TwinPanel,
  TwinPart,
} from '@dt/twin-config'

/**
 * 六类可增删的实体集合。键就是 `TwinConfig` 上的数组字段名。
 * ⚠ 这里的键名与 `TwinConfig` 的字段名必须逐字相同：实体操作按它索引数组，
 * 对不上是编译期错误（`TwinEntityLists` 的约束），不会拖到运行期。
 */
export interface TwinEntityLists {
  parts: TwinPart
  anchors: TwinAnchor
  cameras: TwinCamera
  panels: TwinPanel
  arrows: TwinArrow
  flows: TwinFlowLink
}

/** 实体集合名。 */
export type TwinEntityKind = keyof TwinEntityLists

/** 六类实体的显示名，用于按钮文案与删除确认。 */
export const TWIN_ENTITY_LABELS: Readonly<Record<TwinEntityKind, string>> = {
  parts: '部件',
  anchors: '锚点',
  cameras: '视点',
  panels: '信息牌',
  arrows: '箭头',
  flows: '能量流',
}

/**
 * 当前选中。
 * `model` / `viewpoints` / `roam` 是单例段（模型摆放、视点切换控件、自动漫游），
 * 没有 id。
 */
export type TwinSelection =
  | { kind: 'model' }
  | { kind: 'viewpoints' }
  | { kind: 'roam' }
  | { kind: TwinEntityKind; id: string }

/** 单例段的选中值，供大纲树与检查器共用。 */
export const TWIN_SELECT_MODEL: TwinSelection = { kind: 'model' }
export const TWIN_SELECT_VIEWPOINTS: TwinSelection = { kind: 'viewpoints' }
export const TWIN_SELECT_ROAM: TwinSelection = { kind: 'roam' }

/** 两个选中是不是同一个。⚠ 选中态是对象，`===` 比不出来。 */
export function isSameSelection(
  left: TwinSelection | null,
  right: TwinSelection | null,
): boolean {
  if (left === null || right === null) return left === right
  if (left.kind !== right.kind) return false
  const leftId = 'id' in left ? left.id : ''
  const rightId = 'id' in right ? right.id : ''
  return leftId === rightId
}
