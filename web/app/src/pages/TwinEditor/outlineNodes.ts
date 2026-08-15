/**
 * @fileoverview 大纲树的数据推导：一份配置摊成八个分组的行清单，外加「删了会
 * 连带影响什么」与「一条诊断落在哪个实体上」两处映射。判断全在这里、组件只管画，
 * 这些规则才测得动。
 */
import type { TwinConfig, TwinConfigIssue } from '@dt/twin-config'

import {
  TWIN_ENTITY_LABELS,
  TWIN_SELECT_MODEL,
  TWIN_SELECT_ROAM,
  TWIN_SELECT_VIEWPOINTS,
} from './types'
import type { TwinEntityKind, TwinSelection } from './types'

/** 大纲树上的一行。 */
export interface TwinOutlineRow {
  /**
   * 行 key。
   * ⚠ 必须带上下标：id 允许重复（重复由诊断报出来，不静默改名），只用 id 做 key
   * 会让两行共用一个 key，Vue 的就地复用于是把这两行的本地状态串在一起。
   */
  key: string
  id: string
  kind: TwinEntityKind
  /** 文档序号，从 1 起。⚠ 它就是数组绑定的对齐位次，不只是显示顺序。 */
  index: number
  /** 显示名；名字空着退回 id。 */
  label: string
  /** 名字后面的补充信息，可为空串。 */
  meta: string
  icon: string
  /** 显隐；null = 这一类没有显隐字段（视点）。 */
  visible: boolean | null
  /** 有诊断问题，行上打红点。 */
  flagged: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}

/** 大纲树上的一个分组。 */
export interface TwinOutlineSection {
  key: string
  title: string
  icon: string
  /** 单例段（模型与场景 / 视点切换）点了选它自己；实体段为 null。 */
  selection: TwinSelection | null
  /** 实体段的集合名；单例段为 null，也就没有「+」。 */
  kind: TwinEntityKind | null
  rows: readonly TwinOutlineRow[]
}

/** 删一个实体会连带悬空的引用条数。 */
export interface TwinRemoveImpact {
  panels: number
  flows: number
  viewpoints: number
  /** 上一层没了的下级钻取节点：它们会各自变成一个根。 */
  hierChildren: number
  /** 点击动作指向它的部件：点了不会再打开钻取。 */
  parts: number
}

const NO_IMPACT: TwinRemoveImpact = {
  panels: 0,
  flows: 0,
  viewpoints: 0,
  hierChildren: 0,
  parts: 0,
}

const SECTION_ICON: Readonly<Record<TwinEntityKind, string>> = {
  parts: 'layers',
  anchors: 'magnet',
  cameras: 'play',
  panels: 'layout-template',
  arrows: 'arrow-right',
  flows: 'activity',
  hierNodes: 'folder',
}

/** 单例段：没有行、点了就选自己的那几节。 */
type TwinSingleKey = 'model' | 'viewpoints' | 'roam'

/** 十个分组的顺序；三个单例段夹在实体段中间。 */
const SECTION_ORDER: readonly (TwinEntityKind | TwinSingleKey)[] = [
  'model',
  'parts',
  'anchors',
  'cameras',
  'viewpoints',
  'roam',
  'panels',
  'arrows',
  'flows',
  'hierNodes',
]

const ENTITY_KINDS: readonly TwinEntityKind[] = [
  'parts',
  'anchors',
  'cameras',
  'panels',
  'arrows',
  'flows',
  'hierNodes',
]

/** 每种问题的短标签。 */
export const TWIN_ISSUE_LABELS: Readonly<
  Record<TwinConfigIssue['kind'], string>
> = {
  'duplicate-id': 'id 重复',
  'dangling-camera': '视点丢失',
  'dangling-anchor': '锚点丢失',
  'flow-too-short': '流画不出',
  'dangling-hier-parent': '上一层丢失',
  'dangling-hier-node': '钻取节点丢失',
  'hier-cycle': '钻取成环',
  'roam-too-short': '漫游飞不起来',
}

/** 一行渲染所需的、与实体种类无关的那几个值。 */
interface RowInput {
  kind: TwinEntityKind
  id: string
  name: string
  meta: string
  visible: boolean | null
}

/** 七类实体各自怎么摊成行。⚠ 视点与钻取节点没有 visibility，`visible` 恒为 null。 */
const ROW_INPUTS: Readonly<
  Record<TwinEntityKind, (config: TwinConfig) => RowInput[]>
> = {
  parts: (config) =>
    config.parts.map((part) => ({
      kind: 'parts',
      id: part.id,
      name: part.name,
      meta: `${part.nodes.length} 节点`,
      visible: part.visibility.visible,
    })),
  anchors: (config) =>
    config.anchors.map((anchor) => ({
      kind: 'anchors',
      id: anchor.id,
      name: anchor.name,
      meta: anchor.unit,
      visible: anchor.visibility.visible,
    })),
  cameras: (config) =>
    config.cameras.map((camera) => ({
      kind: 'cameras',
      id: camera.id,
      name: camera.name,
      meta: camera.isDefault ? '默认' : '',
      visible: null,
    })),
  panels: (config) =>
    config.panels.map((panel) => ({
      kind: 'panels',
      id: panel.id,
      name: panel.name,
      meta: `${panel.fields.length} 字段`,
      visible: panel.visibility.visible,
    })),
  arrows: (config) =>
    config.arrows.map((arrow) => ({
      kind: 'arrows',
      id: arrow.id,
      name: arrow.name,
      meta: arrow.labelText,
      visible: arrow.visibility.visible,
    })),
  flows: (config) =>
    config.flows.map((flow) => ({
      kind: 'flows',
      id: flow.id,
      name: flow.name,
      meta: `${flow.pathAnchors.length} 锚点`,
      visible: flow.visibility.visible,
    })),
  hierNodes: (config) =>
    config.hierNodes.map((node) => ({
      kind: 'hierNodes',
      id: node.id,
      name: node.name,
      meta: `${node.fields.length} 字段`,
      visible: null,
    })),
}

function buildRows(
  items: readonly RowInput[],
  flaggedIds: ReadonlySet<string>,
): TwinOutlineRow[] {
  return items.map((item, index) => ({
    key: `${item.kind}:${index}:${item.id}`,
    id: item.id,
    kind: item.kind,
    index: index + 1,
    label: item.name === '' ? item.id : item.name,
    meta: item.meta,
    icon: SECTION_ICON[item.kind],
    visible: item.visible,
    flagged: flaggedIds.has(item.id),
    canMoveUp: index > 0,
    canMoveDown: index < items.length - 1,
  }))
}

/** 三个单例段各自的标题、图标与选中值。 */
const SINGLE_SECTIONS: Readonly<
  Record<
    TwinSingleKey,
    { title: string; icon: string; selection: TwinSelection }
  >
> = {
  model: {
    title: '模型与场景',
    icon: 'building',
    selection: TWIN_SELECT_MODEL,
  },
  viewpoints: {
    title: '视点切换',
    icon: 'list-checks',
    selection: TWIN_SELECT_VIEWPOINTS,
  },
  roam: { title: '自动漫游', icon: 'route', selection: TWIN_SELECT_ROAM },
}

function singleSection(key: TwinSingleKey): TwinOutlineSection {
  const meta = SINGLE_SECTIONS[key]
  return {
    key,
    title: meta.title,
    icon: meta.icon,
    selection: meta.selection,
    kind: null,
    rows: [],
  }
}

function isEntityKind(value: string): value is TwinEntityKind {
  return ENTITY_KINDS.some((kind) => kind === value)
}

/**
 * 摊出八个分组。
 * @param config 当前配置
 * @param flaggedIds 有诊断问题的实体 id
 */
export function buildTwinOutline(
  config: TwinConfig,
  flaggedIds: ReadonlySet<string>,
): TwinOutlineSection[] {
  return SECTION_ORDER.map((key) => {
    if (!isEntityKind(key)) return singleSection(key)
    return {
      key,
      title: TWIN_ENTITY_LABELS[key],
      icon: SECTION_ICON[key],
      selection: null,
      kind: key,
      rows: buildRows(ROW_INPUTS[key](config), flaggedIds),
    }
  })
}

/**
 * 删掉一个实体之后会有多少条引用悬空。
 * ⚠ 只数不清：悬空引用留给 `collectTwinConfigIssues` 报出来，静默清掉的话
 * 用户会以为自己配的东西凭空消失了。
 * @param config 当前配置
 * @param kind 实体集合
 * @param id 要删的实体 id
 */
export function twinRemoveImpact(
  config: TwinConfig,
  kind: TwinEntityKind,
  id: string,
): TwinRemoveImpact {
  if (kind === 'anchors') {
    return {
      ...NO_IMPACT,
      panels: config.panels.filter((panel) => panel.anchorId === id).length,
      flows: config.flows.filter((flow) => flow.pathAnchors.includes(id))
        .length,
    }
  }
  if (kind === 'cameras') {
    return {
      ...NO_IMPACT,
      viewpoints: config.viewpoints.items.filter((item) => item === id).length,
    }
  }
  if (kind === 'hierNodes') {
    return {
      ...NO_IMPACT,
      hierChildren: config.hierNodes.filter((node) => node.parentId === id)
        .length,
      parts: config.parts.filter((part) => part.clickHierNode === id).length,
    }
  }
  return NO_IMPACT
}

/**
 * 删除确认里那句「会连带影响什么」；没有连带影响时返回空串。
 * @param config 当前配置
 * @param kind 实体集合
 * @param id 要删的实体 id
 */
export function twinRemoveImpactText(
  config: TwinConfig,
  kind: TwinEntityKind,
  id: string,
): string {
  const impact = twinRemoveImpact(config, kind, id)
  const clauses: string[] = []
  if (impact.panels > 0) clauses.push(`${impact.panels} 张信息牌`)
  if (impact.flows > 0) clauses.push(`${impact.flows} 条能量流`)
  if (impact.viewpoints > 0)
    clauses.push(`视点切换里的 ${impact.viewpoints} 项`)
  if (impact.hierChildren > 0)
    clauses.push(`${impact.hierChildren} 个下级钻取节点`)
  if (impact.parts > 0) clauses.push(`${impact.parts} 个部件的点击动作`)
  if (clauses.length === 0) return ''
  return `${clauses.join('、')}会悬空，需要自己改绑`
}

/**
 * 一条诊断落在哪个实体上。
 * ⚠ 按 `path` 的头一段判，不按 `kind`：悬空视点的 `entityId` 是那个**不存在**的
 * 视点 id，能跳的只有引用它的视点切换段。
 * @param issue 一条配置问题
 */
export function twinIssueSelection(
  issue: TwinConfigIssue,
): TwinSelection | null {
  const head = /^[a-zA-Z]+/.exec(issue.path)?.[0] ?? ''
  if (head === 'viewpoints') return TWIN_SELECT_VIEWPOINTS
  if (head === 'roamTour') return TWIN_SELECT_ROAM
  if (!isEntityKind(head)) return null
  return { kind: head, id: issue.entityId }
}

/**
 * 诊断涉及的实体 id 集合，供大纲树打红点。
 * @param issues 全部配置问题
 */
export function twinFlaggedIds(
  issues: readonly TwinConfigIssue[],
): Set<string> {
  return new Set(issues.map((issue) => issue.entityId))
}
