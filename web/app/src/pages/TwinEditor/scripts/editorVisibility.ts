/**
 * @fileoverview 左栏眼睛的编辑态显隐覆盖；它只生成交给编辑视口与大纲的配置，
 * 永远不写回文档里的「初始可见」。
 */
import type { TwinConfig, TwinVisibilityRule } from '@dt/twin-config'

import type { TwinEntityKind } from './types'

/** 有显隐规则、也能在编辑视口临时隐藏的五类实体。 */
type EditorVisibleKind = Exclude<TwinEntityKind, 'cameras'>

export interface EditorVisibilityTarget {
  kind: TwinEntityKind
  id: string
}

function keyOf(target: EditorVisibilityTarget): string {
  return `${target.kind}:${target.id}`
}

/** 翻转一个实体的编辑态显隐，返回新集合供 Vue 按引用追踪。 */
export function toggleEditorVisibility(
  hidden: ReadonlySet<string>,
  target: EditorVisibilityTarget,
): ReadonlySet<string> {
  const next = new Set(hidden)
  const key = keyOf(target)
  if (!next.delete(key)) next.add(key)
  return next
}

function applyToList<T extends { id: string; visibility: TwinVisibilityRule }>(
  kind: EditorVisibleKind,
  items: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  return items.map((item) => ({
    ...item,
    visibility: {
      ...item.visibility,
      visible: !hidden.has(keyOf({ kind, id: item.id })),
    },
  }))
}

/**
 * 生成只供编辑器展示的配置：默认全部显示，左栏关掉的实体才隐藏。
 * @param config 持久化文档配置
 * @param hidden 左栏眼睛关掉的实体键
 */
export function withEditorVisibility(
  config: TwinConfig,
  hidden: ReadonlySet<string>,
): TwinConfig {
  return {
    ...config,
    parts: applyToList('parts', config.parts, hidden),
    anchors: applyToList('anchors', config.anchors, hidden),
    panels: applyToList('panels', config.panels, hidden),
    arrows: applyToList('arrows', config.arrows, hidden),
    flows: applyToList('flows', config.flows, hidden),
  }
}
