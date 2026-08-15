/**
 * @fileoverview 归一化吞不掉的那两类错：重复 id 与悬空引用。
 * 归一化只管形状，这两样必须响亮报出去——静默降级对人尚可忍受，对 Agent 是致命的（ADR-0012 四）。
 */
import { MIN_ROAM_TOUR_STOPS } from './normalizeScene'
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
  ]
}
