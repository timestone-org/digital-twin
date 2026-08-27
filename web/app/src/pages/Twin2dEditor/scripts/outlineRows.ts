/**
 * @fileoverview 左栏大纲里节点 / 连线 / 标注三段的行推导：一个实体 → 一行画什么
 * （主名、副名、图标、徽标，以及「点它选中什么」）。纯读，不改文档也不改选中。
 *
 * ⚠ 每行都要主名加副名两段：只画 id 的话几十行下来认不出谁是谁，而这正是大纲存在
 * 的理由。
 * ⚠ 取样式一律走 `twin2dStyleResolver`（同 id 以文档为准，§13.4），不另写一遍查表：
 * 大纲报的样式名与画面上画的解成两份时，两处单看都对。
 */
import { TWIN_2D_EDGE_PRESETS, twin2dStyleResolver } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dEndpoint, Twin2dMarkKind } from '@dt/twin2d'

import type { Twin2dEditorSelection, Twin2dPickKind } from './editorSelection'

/** 大纲里一行画什么。 */
export interface Twin2dOutlineRow {
  /** 列表键，也是这一行的测试钩子；样式那一段两类同 id 并存，所以键带类别。 */
  key: string
  title: string
  note: string
  icon: string
  badge: string
  warn: boolean
  selected: boolean
  /**
   * 点这一行怎么选中。
   * ⚠ 随行走而不是随段走：样式那一段落在另一条轴上，由段自己分叉的话，四段的行
   * 循环就摊不成同一个。
   */
  pick: (additive: boolean) => void
}

/** 三类实体各自的行首图标。 */
export const TWIN_2D_OUTLINE_ICONS: Readonly<Record<Twin2dPickKind, string>> = {
  nodes: 'layout-grid',
  edges: 'route',
  marks: 'ruler',
}

/** 三档标注各自的图标与名字。 */
const MARK_KINDS: Readonly<
  Record<Twin2dMarkKind, { icon: string; label: string }>
> = {
  rect: { icon: 'layout-template', label: '辅助框' },
  line: { icon: 'ruler', label: '辅助线' },
  text: { icon: 'type', label: '文字' },
}

/**
 * 点一行画布上的实体。
 * ⚠ 修饰键与画布上那一下同一条判据：两处各判各的话，同一个手势在大纲里是加选、
 * 在画布上是顶替。
 * @param selection 两条选中轴
 * @param kind 这一类
 * @param id 这一行
 * @param additive 按住了 Ctrl / ⌘
 */
function pickOne(
  selection: Twin2dEditorSelection,
  kind: Twin2dPickKind,
  id: string,
  additive: boolean,
): void {
  if (additive) selection.toggle(kind, id)
  else selection.select(kind, id)
}

/**
 * 连线一端落在谁身上；没有显示名、或端点悬空时退到节点 id。
 * ⚠ 悬空那一支只在没过归一化的配置上走得到（归一化会丢掉整条线），报 id 总好过
 * 画一行空箭头。
 * @param config 整份配置
 * @param at 一端
 */
function endName(config: Twin2dConfig, at: Twin2dEndpoint): string {
  const node = config.nodes.find((item) => item.id === at.nodeId)
  return node !== undefined && node.label !== '' ? node.label : at.nodeId
}

/**
 * 连线样式的名字；同 id 以文档为准（§13.4），与节点样式那一份同口径。
 * @param config 整份配置
 * @param id 样式 id
 */
function edgeStyleName(config: Twin2dConfig, id: string): string | undefined {
  const hit =
    config.edgeStyles.find((style) => style.id === id) ??
    TWIN_2D_EDGE_PRESETS.find((style) => style.id === id)
  return hit?.name
}

/**
 * 节点那一段的行：主名是显示名（没有就退到 id），副名是样式名。
 * @param config 整份配置
 * @param selection 两条选中轴
 */
function nodeRows(
  config: Twin2dConfig,
  selection: Twin2dEditorSelection,
): readonly Twin2dOutlineRow[] {
  const styleOf = twin2dStyleResolver(config)
  return config.nodes.map((node) => {
    const style = styleOf(node.styleId)
    return {
      key: node.id,
      title: node.label !== '' ? node.label : node.id,
      note: style === null ? `样式缺失 · ${node.styleId}` : style.name,
      icon: TWIN_2D_OUTLINE_ICONS.nodes,
      badge: node.badge,
      warn: style === null,
      selected: selection.isPicked('nodes', node.id),
      pick: (additive: boolean) =>
        pickOne(selection, 'nodes', node.id, additive),
    }
  })
}

/**
 * 连线那一段的行：主名是两端，副名是样式名。
 * @param config 整份配置
 * @param selection 两条选中轴
 */
function edgeRows(
  config: Twin2dConfig,
  selection: Twin2dEditorSelection,
): readonly Twin2dOutlineRow[] {
  return config.edges.map((edge) => {
    const name = edgeStyleName(config, edge.styleId)
    return {
      key: edge.id,
      title: `${endName(config, edge.from)} → ${endName(config, edge.to)}`,
      note: name ?? `样式缺失 · ${edge.styleId}`,
      icon: TWIN_2D_OUTLINE_ICONS.edges,
      badge: edge.label,
      warn: name === undefined,
      selected: selection.isPicked('edges', edge.id),
      pick: (additive: boolean) =>
        pickOne(selection, 'edges', edge.id, additive),
    }
  })
}

/**
 * 标注那一段的行：主名是文字（没有就退到 id），副名是档位与上下层。
 * @param config 整份配置
 * @param selection 两条选中轴
 */
function markRows(
  config: Twin2dConfig,
  selection: Twin2dEditorSelection,
): readonly Twin2dOutlineRow[] {
  return config.marks.map((mark) => ({
    key: mark.id,
    title: mark.text !== '' ? mark.text : mark.id,
    note: `${MARK_KINDS[mark.kind].label} · ${
      mark.zOrder === 'above' ? '节点之上' : '节点之下'
    }`,
    icon: MARK_KINDS[mark.kind].icon,
    badge: '',
    warn: false,
    selected: selection.isPicked('marks', mark.id),
    pick: (additive: boolean) => pickOne(selection, 'marks', mark.id, additive),
  }))
}

/**
 * 一段大纲的行，文档序即层序。
 * @param config 整份配置
 * @param selection 两条选中轴
 * @param kind 哪一类
 */
export function twin2dOutlineRows(
  config: Twin2dConfig,
  selection: Twin2dEditorSelection,
  kind: Twin2dPickKind,
): readonly Twin2dOutlineRow[] {
  if (kind === 'nodes') return nodeRows(config, selection)
  if (kind === 'edges') return edgeRows(config, selection)
  return markRows(config, selection)
}
