/**
 * @fileoverview 2D 孪生编辑器里「现在选中的是什么」，以及五类实体集合的名字。
 * 大纲、画布拾取、检查器分派三处共用同一套，各写各的会在「大纲里选中了 A、
 * 检查器画的是 B」这种地方对不上。
 */
import type {
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dMark,
  Twin2dNode,
  Twin2dNodeStyle,
} from '@dt/twin2d'

/**
 * 五类可增删的实体集合。键就是 `Twin2dConfig` 上的数组字段名。
 * ⚠ 键名与 `Twin2dConfig` 的字段名必须逐字相同：实体操作按它索引数组，
 * 对不上是编译期错误，不会拖到运行期。
 */
export interface Twin2dEntityLists {
  nodes: Twin2dNode
  edges: Twin2dEdge
  marks: Twin2dMark
  styles: Twin2dNodeStyle
  edgeStyles: Twin2dEdgeStyle
}

/** 实体集合名。 */
export type Twin2dEntityKind = keyof Twin2dEntityLists

/** 五类实体的显示名，用于大纲分段、按钮文案与删除确认。 */
export const TWIN_2D_ENTITY_LABELS: Readonly<Record<Twin2dEntityKind, string>> =
  {
    nodes: '节点',
    edges: '连线',
    marks: '标注',
    styles: '节点样式',
    edgeStyles: '连线样式',
  }

/**
 * 当前选中。
 * `canvas` 是单例段（画布自己的尺寸、栅格与底图），没有 id。
 */
export type Twin2dSelection =
  { kind: 'canvas' } | { kind: Twin2dEntityKind; id: string }

/** 画布这一段的选中值，供大纲与检查器共用。 */
export const TWIN_2D_SELECT_CANVAS: Twin2dSelection = { kind: 'canvas' }
