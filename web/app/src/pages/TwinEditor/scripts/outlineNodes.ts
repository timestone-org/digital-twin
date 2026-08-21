/**
 * @fileoverview 大纲树的数据推导：置顶的「场景」区（三个单例）、七个实体分组的
 * 夹视图与散行清单，外加「删了会连带影响什么」与「一条诊断落在哪个实体上」两处
 * 映射。判断全在这里、组件只管画，这些规则才测得动。
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
  /** 文档序号，从 1 起。⚠ 它就是数组绑定的对齐位次，进出文件夹都不改它。 */
  index: number
  /** 显示名；名字空着退回 id。 */
  label: string
  /** 名字后面的补充信息，可为空串。 */
  meta: string
  /** 显隐；null = 这一类没有显隐字段（视点、钻取节点）。 */
  visible: boolean | null
  /** 有诊断问题，行上打红点。 */
  flagged: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}

/** 段内的一个文件夹视图：成员按文档序排。 */
export interface TwinOutlineFolderView {
  /** 折叠键 `folder:<id>`，进大纲树的本地折叠集。 */
  key: string
  id: string
  kind: TwinEntityKind
  /** 显示名；名字空着退回 id。 */
  label: string
  rows: readonly TwinOutlineRow[]
}

/** 大纲树上的一个实体分组：夹在前（按夹表序）、散行在后（按文档序）。 */
export interface TwinOutlineSection {
  key: string
  title: string
  kind: TwinEntityKind
  folders: readonly TwinOutlineFolderView[]
  /** 不在任何夹里的散行。 */
  rows: readonly TwinOutlineRow[]
  /** 段内实体总数（夹内 + 散行）。 */
  count: number
}

/** 置顶「场景」区的一行：单例配置页的入口，点了选它自己。 */
export interface TwinSceneEntry {
  key: 'model' | 'viewpoints' | 'roam'
  title: string
  icon: string
  selection: TwinSelection
}

/** 「场景」区的三行：模型摆放、视点切换、自动漫游。 */
export const TWIN_SCENE_ENTRIES: readonly TwinSceneEntry[] = [
  {
    key: 'model',
    title: '模型与场景',
    icon: 'building',
    selection: TWIN_SELECT_MODEL,
  },
  {
    key: 'viewpoints',
    title: '视点切换',
    icon: 'list-checks',
    selection: TWIN_SELECT_VIEWPOINTS,
  },
  {
    key: 'roam',
    title: '自动漫游',
    icon: 'route',
    selection: TWIN_SELECT_ROAM,
  },
]

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

/** 七个实体分组的顺序。 */
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
    visible: item.visible,
    flagged: flaggedIds.has(item.id),
    canMoveUp: index > 0,
    canMoveDown: index < items.length - 1,
  }))
}

function isEntityKind(value: string): value is TwinEntityKind {
  return ENTITY_KINDS.some((kind) => kind === value)
}

function buildSection(
  kind: TwinEntityKind,
  config: TwinConfig,
  flaggedIds: ReadonlySet<string>,
): TwinOutlineSection {
  const rows = buildRows(ROW_INPUTS[kind](config), flaggedIds)
  const folders = config.folders.filter((folder) => folder.kind === kind)
  const grouped = new Map<string, TwinOutlineRow[]>(
    folders.map((folder) => [folder.id, []]),
  )
  const loose: TwinOutlineRow[] = []
  for (const row of rows) {
    // 行进哪个夹按成员表找先见的那一个；重复 id 的两行会进同一个夹，文档序不乱
    const home = folders.find((folder) => folder.itemIds.includes(row.id))
    const bucket = home === undefined ? loose : (grouped.get(home.id) ?? loose)
    bucket.push(row)
  }
  return {
    key: kind,
    title: TWIN_ENTITY_LABELS[kind],
    kind,
    folders: folders.map((folder) => ({
      key: `folder:${folder.id}`,
      id: folder.id,
      kind,
      label: folder.name === '' ? folder.id : folder.name,
      rows: grouped.get(folder.id) ?? [],
    })),
    rows: loose,
    count: rows.length,
  }
}

/**
 * 摊出七个实体分组（夹视图 + 散行）。「场景」区是静态的 `TWIN_SCENE_ENTRIES`。
 * @param config 当前配置
 * @param flaggedIds 有诊断问题的实体 id
 */
export function buildTwinOutline(
  config: TwinConfig,
  flaggedIds: ReadonlySet<string>,
): TwinOutlineSection[] {
  return ENTITY_KINDS.map((kind) => buildSection(kind, config, flaggedIds))
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
 * ⚠ 空串还决定要不要问：无连带的删除直接删、靠撤销兜底，只有非空才弹二次确认。
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
