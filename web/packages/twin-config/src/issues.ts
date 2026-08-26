/**
 * @fileoverview 归一化吞不掉的那两类错：重复 id 与悬空引用。
 * 归一化只管形状，这两样必须响亮报出去——静默降级对人尚可忍受，对 Agent 是致命的（ADR-0012 四）。
 */
import { MIN_ROAM_TOUR_STOPS } from './normalizeScene'
import { panelFieldSpan, panelKindUsesRange } from './panelGraph'
import type { TwinConfig } from './types'

/** 漫游是单例段，没有实体 id；诊断面板按它跳到漫游那一节。 */
const ROAM_TOUR_ENTITY_ID = 'roamTour'

/** 问题种类。 */
export const TWIN_CONFIG_ISSUE_KINDS = [
  'duplicate-id',
  'dangling-camera',
  'dangling-anchor',
  'flow-too-short',
  'dangling-hier-parent',
  'dangling-hier-node',
  'hier-cycle',
  'roam-too-short',
  'tint-no-stops',
  'tint-empty-range',
  'panel-empty-range',
] as const
export type TwinConfigIssueKind = (typeof TWIN_CONFIG_ISSUE_KINDS)[number]

/** 一条配置问题。`path` 是出问题的字段路径，如 `anchors[2].id`。 */
export interface TwinConfigIssue {
  kind: TwinConfigIssueKind
  entityId: string
  path: string
  detail: string
}

function duplicateIds(
  section: string,
  items: readonly { id: string }[],
): TwinConfigIssue[] {
  const seen = new Set<string>()
  const out: TwinConfigIssue[] = []
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      out.push({
        kind: 'duplicate-id',
        entityId: item.id,
        path: `${section}[${index}].id`,
        detail: '同一个 id 出现两次，缝合实时值时后者会覆盖前者',
      })
    }
    seen.add(item.id)
  })
  return out
}

/**
 * 视点切换控件里列到的、但 `cameras` 里没有的 id。
 * ⚠ 渲染层对这种项是「直接不显示」——不报出来的话，用户看到的是一个少了
 * 两三个按钮的切换条，而配置里明明写着。
 */
function danglingCameras(config: TwinConfig): TwinConfigIssue[] {
  const known = new Set(config.cameras.map((item) => item.id))
  return config.viewpoints.items
    .map((id, index) => ({ id, index }))
    .filter((ref) => !known.has(ref.id))
    .map((ref) => ({
      kind: 'dangling-camera' as const,
      entityId: ref.id,
      path: `viewpoints.items[${ref.index}]`,
      detail: `找不到视点 ${ref.id}，切换条上会少这一个`,
    }))
}

/**
 * 信息牌指到一个不存在的锚点。
 * ⚠ 渲染层对这种牌是「退回自己的坐标继续画」——不报出来的话，牌会安静地
 * 停在原点或某个旧位置，而配置里明明写着锚点名。
 */
function danglingPanelAnchors(
  config: TwinConfig,
  known: ReadonlySet<string>,
): TwinConfigIssue[] {
  return config.panels
    .map((panel, index) => ({ panel, index }))
    .filter((ref) => ref.panel.anchorId !== '')
    .filter((ref) => !known.has(ref.panel.anchorId))
    .map((ref) => ({
      kind: 'dangling-anchor' as const,
      entityId: ref.panel.id,
      path: `panels[${ref.index}].anchorId`,
      detail: `找不到锚点 ${ref.panel.anchorId}，这张牌会退回自己的坐标`,
    }))
}

/** 能量流路径上指到一个不存在的锚点。那一段会被直接跳过。 */
function danglingFlowAnchors(
  config: TwinConfig,
  known: ReadonlySet<string>,
): TwinConfigIssue[] {
  return config.flows.flatMap((flow, index) =>
    flow.pathAnchors
      .map((anchorId, slot) => ({ anchorId, slot }))
      .filter((ref) => !known.has(ref.anchorId))
      .map((ref) => ({
        kind: 'dangling-anchor' as const,
        entityId: flow.id,
        path: `flows[${index}].pathAnchors[${ref.slot}]`,
        detail: `找不到锚点 ${ref.anchorId}，这条流会少一段`,
      })),
  )
}

/**
 * 能量流可解析的点不足两个。
 * ⚠ 一条线至少要两点，渲染层对这种流是整条不画——不报出来的话，用户看到的是
 * 「配了一条流但画面上什么都没有」。
 */
function shortFlows(
  config: TwinConfig,
  known: ReadonlySet<string>,
): TwinConfigIssue[] {
  return config.flows
    .map((flow, index) => ({ flow, index }))
    .filter(
      (ref) => ref.flow.pathAnchors.filter((id) => known.has(id)).length < 2,
    )
    .map((ref) => ({
      kind: 'flow-too-short' as const,
      entityId: ref.flow.id,
      path: `flows[${ref.index}].pathAnchors`,
      detail: '可解析的路径点不足两个，这条流画不出来',
    }))
}

/**
 * 钻取节点的父指针指到一个不存在的节点。
 * ⚠ 建树时这种节点按根处理——不报出来的话，用户看到的是「明明挂在 A 下面的
 * 一层，钻取里却自己成了一个根」。
 */
function danglingHierParents(config: TwinConfig): TwinConfigIssue[] {
  const known = new Set(config.hierNodes.map((item) => item.id))
  return config.hierNodes
    .map((node, index) => ({ node, index }))
    .filter((ref) => ref.node.parentId !== null)
    .filter((ref) => !known.has(ref.node.parentId ?? ''))
    .map((ref) => ({
      kind: 'dangling-hier-parent' as const,
      entityId: ref.node.id,
      path: `hierNodes[${ref.index}].parentId`,
      detail: `找不到上一层 ${ref.node.parentId ?? ''}，这一层会变成一个根`,
    }))
}

/** 从这个节点一路往上，能不能走回它自己。`seen` 同时挡住无限循环。 */
function loopsBackTo(
  byId: ReadonlyMap<string, string | null>,
  start: string,
): boolean {
  const seen = new Set<string>([start])
  let cursor = byId.get(start) ?? null
  while (cursor !== null) {
    if (cursor === start) return true
    if (seen.has(cursor)) return false
    seen.add(cursor)
    cursor = byId.get(cursor) ?? null
  }
  return false
}

/**
 * 父子成环。
 * ⚠ 这一条必须挡住：环上的节点从任何根都走不到，`buildHierTree` 于是把它们
 * 整片丢掉，表现是「配了一层，钻取里根本没有它」。
 */
function hierCycles(config: TwinConfig): TwinConfigIssue[] {
  const parents = new Map(
    config.hierNodes.map((item) => [item.id, item.parentId]),
  )
  return config.hierNodes
    .map((node, index) => ({ node, index }))
    .filter((ref) => loopsBackTo(parents, ref.node.id))
    .map((ref) => ({
      kind: 'hier-cycle' as const,
      entityId: ref.node.id,
      path: `hierNodes[${ref.index}].parentId`,
      detail: '父子指到自己头上成了环，这几层在钻取里整片不出现',
    }))
}

/**
 * 部件的点击动作指到一个不存在的钻取节点。
 * ⚠ 渲染层对这种部件是「不开钻取」——不报出来的话，用户看到的只是
 * 「点了这个部件没反应」，而配置里明明选了一层。
 */
function danglingHierClicks(config: TwinConfig): TwinConfigIssue[] {
  const known = new Set(config.hierNodes.map((item) => item.id))
  return config.parts
    .map((part, index) => ({ part, index }))
    .filter((ref) => ref.part.clickHierNode !== '')
    .filter((ref) => !known.has(ref.part.clickHierNode))
    .map((ref) => ({
      kind: 'dangling-hier-node' as const,
      entityId: ref.part.id,
      path: `parts[${ref.index}].clickHierNode`,
      detail: `找不到钻取节点 ${ref.part.clickHierNode}，点这个部件不会打开钻取`,
    }))
}

/**
 * 开了分档染色，却一档都没配。
 * ⚠ 渲染层对这种规则是「永远走回落色」——不报出来的话，用户看到的是
 * 「绑了点位、值也在变，颜色却一动不动」，而那与点位没通表现完全一样。
 */
function tintWithoutStops(config: TwinConfig): TwinConfigIssue[] {
  return config.parts
    .map((part, index) => ({ part, index }))
    .filter((ref) => ref.part.tint?.mode === 'stops')
    .filter((ref) => ref.part.tint?.stops.length === 0)
    .map((ref) => ({
      kind: 'tint-no-stops' as const,
      entityId: ref.part.id,
      path: `parts[${ref.index}].tint.stops`,
      detail: '一档都没配，这个部件的颜色永远只会是回落色',
    }))
}

/**
 * 区间档的上界不大于下界，这一档永远命中不了。
 * ⚠ 上界**不含**，所以 `from === to` 也是空区间——它看起来像「正好等于这个值」，
 * 实际一次都不会命中，而界面上两个数字并排摆着看不出问题。
 */
function emptyTintRanges(config: TwinConfig): TwinConfigIssue[] {
  return config.parts.flatMap((part, index) =>
    (part.tint?.stops ?? [])
      .map((stop, slot) => ({ stop, slot }))
      .filter((ref) => ref.stop.match === 'range')
      .filter((ref) => ref.stop.from !== null && ref.stop.to !== null)
      .filter((ref) => (ref.stop.from ?? 0) >= (ref.stop.to ?? 0))
      .map((ref) => ({
        kind: 'tint-empty-range' as const,
        entityId: part.id,
        path: `parts[${index}].tint.stops[${ref.slot}]`,
        detail: `区间 [${ref.stop.from}, ${ref.stop.to}) 是空的，这一档永远不会命中`,
      })),
  )
}

/**
 * 漫游轨迹里列到的、但 `cameras` 里没有的 id。
 * ⚠ 运行态对这种项是「跳过这一站」——不报出来的话，用户看到的是轨迹莫名少飞
 * 两站，而配置里明明还写着。
 */
function danglingRoamCameras(
  config: TwinConfig,
  known: ReadonlySet<string>,
): TwinConfigIssue[] {
  return config.roamTour.items
    .map((id, index) => ({ id, index }))
    .filter((ref) => !known.has(ref.id))
    .map((ref) => ({
      kind: 'dangling-camera' as const,
      entityId: ref.id,
      path: `roamTour.items[${ref.index}]`,
      detail: `找不到视点 ${ref.id}，漫游会跳过这一站`,
    }))
}

/**
 * 开了漫游，可用的视点却不足两个。
 * ⚠ 一段都摊不出来时运行态整条不播——不报出来的话，用户看到的是「开关明明
 * 开着，镜头却一动不动」。
 */
function shortRoamTour(
  config: TwinConfig,
  known: ReadonlySet<string>,
): TwinConfigIssue[] {
  const tour = config.roamTour
  const usable = tour.items.filter((id) => known.has(id))
  if (!tour.enabled || usable.length >= MIN_ROAM_TOUR_STOPS) return []
  return [
    {
      kind: 'roam-too-short',
      entityId: ROAM_TOUR_ENTITY_ID,
      path: 'roamTour.items',
      detail: '轨迹上可用的视点不足两个，漫游不会开始',
    },
  ]
}

/**
 * 图形字段的量程上限不大于下限：进度条、仪表与趋势线都算不出「占几成」。
 * ⚠ 渲染层遇到这一档退回纯文本——图形安静地不见了，配置里却明明配着，
 * 不报出来用户只会以为是画法没生效。
 */
function emptyPanelRanges(config: TwinConfig): TwinConfigIssue[] {
  return config.panels.flatMap((panel, index) =>
    panel.fields
      .map((field, slot) => ({ field, slot }))
      .filter((ref) => panelKindUsesRange(ref.field.kind))
      .filter((ref) => panelFieldSpan(ref.field) === null)
      .map((ref) => ({
        kind: 'panel-empty-range' as const,
        entityId: panel.id,
        path: `panels[${index}].fields[${ref.slot}].max`,
        detail: `量程上限 ${ref.field.max} 不大于下限 ${ref.field.min}，这个字段会退回纯文本`,
      })),
  )
}

/**
 * 收齐一份归一化配置里的全部问题，按重复 id → 悬空引用 → 画不出来的顺序；
 * 没有问题返回空数组。
 * @param config 归一化后的配置
 */
export function collectTwinConfigIssues(config: TwinConfig): TwinConfigIssue[] {
  const anchorIds = new Set(config.anchors.map((item) => item.id))
  const cameraIds = new Set(config.cameras.map((item) => item.id))
  return [
    ...duplicateIds('parts', config.parts),
    ...duplicateIds('anchors', config.anchors),
    ...duplicateIds('cameras', config.cameras),
    ...duplicateIds('panels', config.panels),
    ...duplicateIds('arrows', config.arrows),
    ...duplicateIds('flows', config.flows),
    ...duplicateIds('hierNodes', config.hierNodes),
    ...danglingCameras(config),
    ...danglingRoamCameras(config, cameraIds),
    ...danglingPanelAnchors(config, anchorIds),
    ...danglingFlowAnchors(config, anchorIds),
    ...shortFlows(config, anchorIds),
    ...shortRoamTour(config, cameraIds),
    ...danglingHierParents(config),
    ...danglingHierClicks(config),
    ...hierCycles(config),
    ...tintWithoutStops(config),
    ...emptyTintRanges(config),
    ...emptyPanelRanges(config),
  ]
}
