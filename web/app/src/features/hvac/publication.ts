/**
 * @fileoverview 点位绑定的纯换算：草稿 ↔ 入参、可选节点的过滤、心跳的新鲜度。
 *
 * ⚠ 页面上最容易出错的一处是**类型过滤**：区域推荐点位只能绑 `string`、
 * 组合时间点位只能绑 `float`/`double`。后端会再拒一次，但选择器里就该列不出
 * 错的那些——让用户点了保存才被拒，等于让他猜哪个点位能用。
 */
import type {
  AcModelPublication,
  AcModelPublicationInput,
  DtIntent,
  DtSelectOption,
  ModelPublishStatus,
  OpcuaNode,
} from '@dt/contracts'
import {
  MODEL_DURATION_DATA_TYPES,
  MODEL_RECOMMENDATION_DATA_TYPE,
} from '@dt/contracts'

/** AccessLevel 的 CurrentWrite 位。不可写的节点绑上去就是每分钟失败一次。 */
const ACCESS_LEVEL_WRITE = 0x2

/**
 * 心跳多久没动就该标红。
 * ⚠ 取三拍而不是一拍：一次外库抖动就红会让人很快学会无视它，而连续三拍不动
 * 说明的是「这条循环停了」，那是真要看的。
 */
export const PUBLISH_STALE_TICKS = 3
export const PUBLISH_TICK_SECONDS = 60

/** 一次下发的三档去向怎么说。 */
export const PUBLISH_STATUS_VIEW: Record<
  ModelPublishStatus,
  { label: string; intent: DtIntent }
> = {
  ok: { label: '已下发', intent: 'success' },
  degraded: { label: '写了哨兵值', intent: 'warning' },
  failed: { label: '下发失败', intent: 'danger' },
}

/** 页面上正在编辑的那份绑定。 */
export interface PublicationDraft {
  instanceId: string
  recommendationNodeId: string
  /** set_key → node_id；空串 = 这个组合还没绑。 */
  setNodes: Record<string, string>
  isEnabled: boolean
}

/** 还没配过下发时的空草稿。 */
export function emptyDraft(): PublicationDraft {
  return {
    instanceId: '',
    recommendationNodeId: '',
    setNodes: {},
    isEnabled: false,
  }
}

/**
 * 已保存的配置 → 可编辑草稿。
 * ⚠ 只带回**还在服务组合里**的那些绑定：落空的绑定留在库里由后端负责，
 * 草稿里带上它会在保存时被后端拒（那个键已经不在服务组合里了）。
 * @param found 已保存的配置
 * @param servingKeys 模型当前的服务组合
 */
export function draftOf(
  found: AcModelPublication,
  servingKeys: readonly string[],
): PublicationDraft {
  const serving = new Set(servingKeys)
  const setNodes: Record<string, string> = {}
  for (const binding of found.set_bindings) {
    if (serving.has(binding.set_key))
      setNodes[binding.set_key] = binding.node_id
  }
  return {
    instanceId: found.opcua_instance_id,
    recommendationNodeId: found.recommendation_node_id ?? '',
    setNodes,
    isEnabled: found.is_enabled,
  }
}

/**
 * 草稿 → 保存入参。
 * ⚠ 没选点位的组合**整条不进** `set_bindings`：传一个空 node_id 会被当成
 * 一个不存在的节点，而报出来的原因会指向类型不符。
 * @param draft 当前草稿
 * @param servingKeys 模型当前的服务组合
 */
export function toPublicationInput(
  draft: Readonly<PublicationDraft>,
  servingKeys: readonly string[],
): AcModelPublicationInput {
  return {
    opcua_instance_id: draft.instanceId,
    recommendation_node_id:
      draft.recommendationNodeId === '' ? null : draft.recommendationNodeId,
    set_bindings: servingKeys
      .filter((key) => (draft.setNodes[key] ?? '') !== '')
      .map((key) => ({ set_key: key, node_id: draft.setNodes[key] ?? '' })),
    is_enabled: draft.isEnabled,
  }
}

/** 这个节点可写吗。 */
function isWritable(node: OpcuaNode): boolean {
  return (node.access_level & ACCESS_LEVEL_WRITE) !== 0
}

/**
 * 能当区域推荐点位的那些节点。
 * @param nodes 这台实例上的全部节点
 */
export function recommendationOptions(
  nodes: readonly OpcuaNode[],
): DtSelectOption[] {
  return toOptions(
    nodes.filter(
      (node) =>
        node.data_type === MODEL_RECOMMENDATION_DATA_TYPE && isWritable(node),
    ),
  )
}

/**
 * 能当组合时间点位的那些节点。
 * @param nodes 这台实例上的全部节点
 */
export function durationOptions(nodes: readonly OpcuaNode[]): DtSelectOption[] {
  const allowed: readonly string[] = MODEL_DURATION_DATA_TYPES
  return toOptions(
    nodes.filter(
      (node) =>
        node.data_type !== null &&
        allowed.includes(node.data_type) &&
        isWritable(node),
    ),
  )
}

function toOptions(nodes: readonly OpcuaNode[]): DtSelectOption[] {
  return nodes.map((node) => ({
    value: node.id,
    label: `${node.browse_name}（${node.node_id}）`,
  }))
}

/**
 * 草稿与已保存的那份有出入吗——决定「保存」按不按得下去。
 * @param draft 当前草稿
 * @param found 已保存的配置；null = 还没配过
 * @param servingKeys 模型当前的服务组合
 */
export function isDraftDirty(
  draft: Readonly<PublicationDraft>,
  found: AcModelPublication | null,
  servingKeys: readonly string[],
): boolean {
  if (found === null) return draft.instanceId !== ''
  const saved = draftOf(found, servingKeys)
  if (draft.instanceId !== saved.instanceId) return true
  if (draft.recommendationNodeId !== saved.recommendationNodeId) return true
  if (draft.isEnabled !== saved.isEnabled) return true
  return servingKeys.some(
    (key) => (draft.setNodes[key] ?? '') !== (saved.setNodes[key] ?? ''),
  )
}

/** 草稿里已经绑上点位的组合数。 */
export function boundCount(
  draft: Readonly<PublicationDraft>,
  servingKeys: readonly string[],
): number {
  return servingKeys.filter((key) => (draft.setNodes[key] ?? '') !== '').length
}

/**
 * 草稿绑齐了吗——绑齐才会发布，而「没绑齐就不发」必须在页面上说出来。
 * @param draft 当前草稿
 * @param servingKeys 模型当前的服务组合
 */
export function isDraftFullyBound(
  draft: Readonly<PublicationDraft>,
  servingKeys: readonly string[],
): boolean {
  if (draft.instanceId === '' || draft.recommendationNodeId === '') return false
  if (servingKeys.length === 0) return false
  return boundCount(draft, servingKeys) === servingKeys.length
}

/**
 * 心跳停了多久（秒）；从来没发过给 null。
 * @param lastPublishedAt 上一次下发的时刻
 * @param now 现在
 */
export function heartbeatAgeSeconds(
  lastPublishedAt: string | null,
  now: number,
): number | null {
  if (lastPublishedAt === null) return null
  const at = Date.parse(lastPublishedAt)
  if (Number.isNaN(at)) return null
  return Math.max(0, (now - at) / 1000)
}

/**
 * 心跳该标红了吗。
 * ⚠ 只在「已启用且绑齐」时才判：没启用的模型本来就不该有心跳，标红只会
 * 教会用户忽略这个颜色。
 * @param found 已保存的配置
 * @param now 现在
 */
export function isHeartbeatStale(
  found: AcModelPublication | null,
  now: number,
): boolean {
  if (found === null || !found.is_enabled || !found.is_fully_bound) return false
  const age = heartbeatAgeSeconds(found.last_published_at, now)
  if (age === null) return true
  return age > PUBLISH_STALE_TICKS * PUBLISH_TICK_SECONDS
}

/** 落空的绑定：`set_key` 已经不在服务组合里了。 */
export function orphanedBindings(
  found: AcModelPublication | null,
): AcModelPublication['set_bindings'] {
  return (found?.set_bindings ?? []).filter((binding) => !binding.is_serving)
}
