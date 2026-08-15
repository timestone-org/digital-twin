/**
 * @fileoverview 钻取面板要画的那几行的推导：卡片摘要、叶子层读数、名字与图标回落。
 * 判断全在这里、组件只管画，回落与占位这几条才测得动。
 */
import type {
  TwinHierNode,
  TwinHierValues,
  TwinPanelField,
} from '@dt/twin-config'
import { childrenOf, formatValueText, hierSummaryFields } from '@dt/twin-config'

/** 取不到值时的占位；空着会让人以为这一行配漏了。 */
export const HIER_NO_READING = '—'
/** 节点没配图标时用它。 */
export const HIER_FALLBACK_ICON = 'folder'

/** 一行读数：标签加已经格式化好的文本。 */
export interface TwinHierReading {
  key: string
  label: string
  text: string
}

/** 一张子项卡片要画的东西。 */
export interface TwinHierCardView {
  id: string
  name: string
  icon: string
  childCount: number
  summary: TwinHierReading[]
}

/** 名字空着退回 id：一张没有任何标识的卡片比显示 id 更糟。 */
export function hierNodeName(node: TwinHierNode): string {
  return node.name === '' ? node.id : node.name
}

export function hierNodeIcon(node: TwinHierNode): string {
  return node.icon === '' ? HIER_FALLBACK_ICON : node.icon
}

/**
 * 一个字段这一刻显示什么。
 * ⚠ 没有实时值时退回静态文本，两个都没有才是占位符——直接留空会让人以为
 * 读数还在路上。
 */
function readingOf(
  nodeId: string,
  field: TwinPanelField,
  values: TwinHierValues,
): string {
  const entry = values[`${nodeId}::${field.key}`]
  if (entry === undefined) {
    return field.staticText === '' ? HIER_NO_READING : field.staticText
  }
  const text = formatValueText(field, entry.value)
  return text === '' ? HIER_NO_READING : text
}

function readingsOf(
  node: TwinHierNode,
  fields: readonly TwinPanelField[],
  values: TwinHierValues,
): TwinHierReading[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label === '' ? field.key : field.label,
    text: readingOf(node.id, field, values),
  }))
}

/**
 * 某一层的子项卡片。
 * @param nodes 归一化后的全部钻取节点
 * @param parentId 当前停在哪一层
 * @param values 实时值，键是 `<节点 id>::<字段 key>`
 */
export function hierCardViews(
  nodes: readonly TwinHierNode[],
  parentId: string,
  values: TwinHierValues,
): TwinHierCardView[] {
  return childrenOf(nodes, parentId).map((node) => ({
    id: node.id,
    name: hierNodeName(node),
    icon: hierNodeIcon(node),
    childCount: childrenOf(nodes, node.id).length,
    summary: readingsOf(node, hierSummaryFields(node), values),
  }))
}

/**
 * 叶子层摊开的全部读数；不是叶子就给空——父层的读数在各自的卡片上。
 * @param nodes 归一化后的全部钻取节点
 * @param nodeId 当前停在哪一层
 * @param values 实时值
 */
export function hierLeafReadings(
  nodes: readonly TwinHierNode[],
  nodeId: string,
  values: TwinHierValues,
): TwinHierReading[] {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined || childrenOf(nodes, nodeId).length > 0) return []
  return readingsOf(node, node.fields, values)
}
