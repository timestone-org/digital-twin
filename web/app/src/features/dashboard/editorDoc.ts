/**
 * @fileoverview 编辑器文档的**纯**操作：增删节点、改几何与配置、增删绑定，
 * 以及整树替换的入参组装。全部不可变，返回新数组，撤销栈因此只存引用。
 *
 * ⚠ 节点与绑定的 id 一经存在**永不重生成**，新建的那些由前端先给
 * （`newClientUuid`），服务端按 id 三路比对（ADR-0012 二）。
 * ⚠ 顺序在这里就钉死成 `(parentId, zIndex, id)` 并原样交给后端：
 * 保存前后顺序不变，两次导出才逐字节相同（ADR-0012 三）。
 */
import type {
  BindingPayload,
  BindingView,
  DashboardNodePayload,
  DashboardNodeView,
  ModuleManifest,
} from '@dt/contracts'

import { fromArchiveDetail } from '@/api/dashboardWire'
import type { LayoutBindingInput, LayoutNodeInput } from '@/api/dashboard'
import { newClientUuid } from '@/api/idempotency'
import { writeConfigAt, type ConfigPath } from './configPath'

/** 新节点落在画布上的初始位置（设计像素），避免与已有节点完全重叠。 */
const NEW_NODE_ORIGIN = { x: 80, y: 80 }
const NEW_NODE_CASCADE_PX = 24
const NEW_NODE_CASCADE_LIMIT = 12

/** 节点几何的可改部分。 */
export interface NodeGeometry {
  x: number
  y: number
  w: number
  h: number
}

/** 节点在同层兄弟里排第几；`index` 越大越靠上。 */
export interface LayerPosition {
  index: number
  total: number
}

/** 坐标与边长的绝对值上限（设计像素），与服务端 `LayoutNodeIn` 同一套。 */
const GEOMETRY_LIMIT_PX = 100000

/** 服务端要求的最小边长；画布上的手感下限另由拖动那层管。 */
const MIN_SIDE_PX = 1

function clampTo(value: number, low: number, high: number): number {
  // ⚠ 非有限数按 0 再夹：按下界兜底会把一个算坏的坐标甩到画布外一万倍远处，
  // 那比停在原点更难看出是算出了 NaN
  const finite = Number.isFinite(value) ? Math.round(value) : 0
  return Math.min(high, Math.max(low, finite))
}

/**
 * 把一份几何收敛到服务端的取值域：四项都是**整数**，宽高至少 1。
 * ⚠ 拖动的位移要除以舞台缩放，除出来几乎必然是小数；不在这里收敛的话，
 * 整树替换会被「整数字段收到了带小数的数」整批拒掉（422），
 * 而那条报错读起来与刚才那次拖动毫无关系。
 * @param geometry 待收敛的几何
 */
export function normalizeGeometry(geometry: NodeGeometry): NodeGeometry {
  return {
    x: clampTo(geometry.x, -GEOMETRY_LIMIT_PX, GEOMETRY_LIMIT_PX),
    y: clampTo(geometry.y, -GEOMETRY_LIMIT_PX, GEOMETRY_LIMIT_PX),
    w: clampTo(geometry.w, MIN_SIDE_PX, GEOMETRY_LIMIT_PX),
    h: clampTo(geometry.h, MIN_SIDE_PX, GEOMETRY_LIMIT_PX),
  }
}

function isSameGeometry(
  node: DashboardNodePayload,
  next: NodeGeometry,
): boolean {
  return (
    node.x === next.x &&
    node.y === next.y &&
    node.w === next.w &&
    node.h === next.h
  )
}

/** 本地草稿节点的时刻。⚠ 它是**本地创建时刻**，保存后由服务端的值取代。 */
function draftMoment(): string {
  return new Date().toISOString()
}

/**
 * 造一个新节点。
 * @param input 所属大屏、模块清单、父节点与同层已有节点数
 */
export function createNode(input: {
  dashboardId: string
  manifest: ModuleManifest
  parentId: string | null
  siblingCount: number
  zIndex: number
}): DashboardNodePayload {
  const step =
    Math.min(input.siblingCount, NEW_NODE_CASCADE_LIMIT) * NEW_NODE_CASCADE_PX
  const moment = draftMoment()
  return {
    id: newClientUuid(),
    dashboardId: input.dashboardId,
    parentId: input.parentId,
    // ⚠ 不给 client_key：`(dashboardId, clientKey)` 唯一，撞了是 409，
    // 而 id 已经由前端保证唯一，再造一个本地键只是多一处可能撞的东西
    clientKey: null,
    moduleType: input.manifest.type,
    x: NEW_NODE_ORIGIN.x + step,
    y: NEW_NODE_ORIGIN.y + step,
    w: input.manifest.defaultSize.width,
    h: input.manifest.defaultSize.height,
    zIndex: input.zIndex,
    isVisible: true,
    // 出厂配置**深克隆**落库。⚠ 与 `ConfigField.default` 不是一回事：那个是不落库的
    // 渲染兜底，这里是显式写进节点的初值，给的是 schema 之外的段（`__cardStyle` 一类），
    // 少了它属性面板显示的与实际渲染的会对不上。只影响新节点，存量不变
    configJson: structuredClone(input.manifest.defaultConfig ?? {}),
    createdAt: moment,
    updatedAt: moment,
    bindings: [],
  }
}

/** 同层的下一个 z 序。 */
export function nextZIndex(
  nodes: readonly DashboardNodePayload[],
  parentId: string | null,
): number {
  const siblings = nodes.filter((node) => node.parentId === parentId)
  return siblings.reduce((top, node) => Math.max(top, node.zIndex + 1), 0)
}

/** 同层已有几个节点。 */
export function siblingCount(
  nodes: readonly DashboardNodePayload[],
  parentId: string | null,
): number {
  return nodes.filter((node) => node.parentId === parentId).length
}

/** 一个节点连同它的整棵子树的 id。 */
export function subtreeIds(
  nodes: readonly DashboardNodePayload[],
  rootId: string,
): readonly string[] {
  const found = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parentId === null || found.has(node.id)) continue
      if (!found.has(node.parentId)) continue
      found.add(node.id)
      grew = true
    }
  }
  return [...found]
}

/**
 * 选中集里剔除「祖先也被选中」后剩下的最上层节点 id。
 * 复制与批量拖动都以它为根：子树跟着根走，选中的后代不再单独动一次。
 */
export function topMostIds(
  nodes: readonly DashboardNodePayload[],
  selectedIds: readonly string[],
): readonly string[] {
  const selected = new Set(selectedIds)
  const byId = new Map(nodes.map((node) => [node.id, node] as const))
  return selectedIds.filter((id) => {
    let cursor = byId.get(id)?.parentId ?? null
    while (cursor !== null) {
      if (selected.has(cursor)) return false
      cursor = byId.get(cursor)?.parentId ?? null
    }
    return true
  })
}

/** 删一个节点连它的子树。 */
export function removeSubtree(
  nodes: readonly DashboardNodePayload[],
  rootId: string,
): DashboardNodePayload[] {
  const doomed = new Set(subtreeIds(nodes, rootId))
  return nodes.filter((node) => !doomed.has(node.id))
}

/** 把一个节点换成改过的版本，其余原样。 */
function replaceNode(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  change: (node: DashboardNodePayload) => DashboardNodePayload,
): DashboardNodePayload[] {
  return nodes.map((node) => (node.id === nodeId ? change(node) : node))
}

/**
 * 改几何，取值先收敛到服务端的取值域。
 * ⚠ 一字未改时**原样返回那个节点**：不返回的话，画布上点一下节点也会走完
 * 「按下—抬起」这条拖动路径，于是每次单击都记一笔撤销并把文档置脏，
 * 而「未保存」这个提示一旦点什么都亮，用户很快就学会无视它。
 */
export function setGeometry(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  geometry: NodeGeometry,
): DashboardNodePayload[] {
  const next = normalizeGeometry(geometry)
  return replaceNode(nodes, nodeId, (node) =>
    isSameGeometry(node, next) ? node : { ...node, ...next },
  )
}

/** 改显隐。 */
export function setVisible(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  isVisible: boolean,
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => ({ ...node, isVisible }))
}

/** 改 z 序。 */
export function setZIndex(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  zIndex: number,
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => ({ ...node, zIndex }))
}

/** 批量改几何：对齐/分布/多选拖动一次落一笔，撤销也只有一步。 */
export function setGeometryBatch(
  nodes: readonly DashboardNodePayload[],
  changes: ReadonlyMap<string, NodeGeometry>,
): DashboardNodePayload[] {
  return nodes.map((node) => {
    const change = changes.get(node.id)
    if (change === undefined) return node
    const next = normalizeGeometry(change)
    return isSameGeometry(node, next) ? node : { ...node, ...next }
  })
}

/** 同层兄弟按 `(zIndex, id)` 定序后的 id 列，队首在最下面。 */
function siblingOrder(
  nodes: readonly DashboardNodePayload[],
  parentId: string | null,
): string[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
    .map((node) => node.id)
}

/** 同层兄弟按当前 z 序重排成 0..n-1；`placed` 给谁就把谁钉到指定位置。 */
function rerankSiblings(
  nodes: readonly DashboardNodePayload[],
  parentId: string | null,
  placed?: { nodeId: string; at: 'front' | 'back' | number },
): DashboardNodePayload[] {
  let order = siblingOrder(nodes, parentId)
  if (placed !== undefined) {
    order = order.filter((id) => id !== placed.nodeId)
    if (placed.at === 'front') order.push(placed.nodeId)
    else if (placed.at === 'back') order.unshift(placed.nodeId)
    else
      order.splice(
        Math.max(0, Math.min(placed.at, order.length)),
        0,
        placed.nodeId,
      )
  }
  const zOf = new Map(order.map((id, index) => [id, index] as const))
  return nodes.map((node) => {
    const z = zOf.get(node.id)
    return z === undefined || node.zIndex === z ? node : { ...node, zIndex: z }
  })
}

/** 置顶：同层重排后排在最后（画得最晚 = 盖在最上）。 */
export function bringToFront(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): DashboardNodePayload[] {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined) return [...nodes]
  return rerankSiblings(nodes, node.parentId, { nodeId, at: 'front' })
}

/** 置底。 */
export function sendToBack(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): DashboardNodePayload[] {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined) return [...nodes]
  return rerankSiblings(nodes, node.parentId, { nodeId, at: 'back' })
}

/** 节点在同层里的层序位置；0 是最下面，`total - 1` 是最上面。不在表里给 null。 */
export function layerPositionOf(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): LayerPosition | null {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined) return null
  const order = siblingOrder(nodes, node.parentId)
  return { index: order.indexOf(nodeId), total: order.length }
}

/**
 * 与紧邻的那个兄弟换位。已经在这一头就原样返回——层序动不了时不该记一笔撤销。
 * ⚠ 落位下标直接用「换位后的位置」：`rerankSiblings` 先摘再插，
 * 摘掉自己之后上/下一位正好落在这个下标上。
 * @param step 1 = 上移一层（更靠上），-1 = 下移一层
 */
function stepLayer(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  step: 1 | -1,
): DashboardNodePayload[] {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined) return [...nodes]
  const order = siblingOrder(nodes, node.parentId)
  const at = order.indexOf(nodeId) + step
  if (at < 0 || at >= order.length) return [...nodes]
  return rerankSiblings(nodes, node.parentId, { nodeId, at })
}

/** 上移一层：盖住原本压在它上面的那个兄弟。 */
export function bringForward(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): DashboardNodePayload[] {
  return stepLayer(nodes, nodeId, 1)
}

/** 下移一层。 */
export function sendBackward(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): DashboardNodePayload[] {
  return stepLayer(nodes, nodeId, -1)
}

/**
 * 挪一个节点到新父层（或同层新位置）。
 * ⚠ 目标是自己或自己的后代时原样返回——挪进自己的子树会造出一个环，
 * 排版的递归会在这个环上转不出来。
 * @param at 目标层内的落位；缺省排到最后
 */
export function moveNode(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  newParentId: string | null,
  at?: number,
): DashboardNodePayload[] {
  const node = nodes.find((item) => item.id === nodeId)
  if (node === undefined) return [...nodes]
  if (newParentId !== null && subtreeIds(nodes, nodeId).includes(newParentId)) {
    return [...nodes]
  }
  const oldParentId = node.parentId
  const reparented = replaceNode(nodes, nodeId, (item) => ({
    ...item,
    parentId: newParentId,
  }))
  const placedTarget = rerankSiblings(reparented, newParentId, {
    nodeId,
    at: at ?? 'front',
  })
  // 老层也要收拢：留洞的话后续「按 z 找相邻」会踩空
  return oldParentId === newParentId
    ? placedTarget
    : rerankSiblings(placedTarget, oldParentId)
}

/** 按路径改配置。 */
export function setConfigValue(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  path: ConfigPath,
  value: unknown,
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => ({
    ...node,
    configJson: writeConfigAt(node.configJson, path, value),
  }))
}

/** 整块替换配置（数组增删行走它）。 */
export function setConfig(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  config: Record<string, unknown>,
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => ({
    ...node,
    configJson: config,
  }))
}

/** 造一条新绑定的空壳，来源与取值由调用方填。 */
export function createBinding(
  nodeId: string,
  fieldKey: string,
): BindingPayload {
  const moment = draftMoment()
  return {
    id: newClientUuid(),
    nodeId,
    fieldKey,
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: moment,
    updatedAt: moment,
  }
}

/**
 * 写一条绑定：同 `fieldKey` 的原地替换（**id 沿用旧的**），没有则追加。
 * ⚠ 沿用旧 id 是这套写入面的地基：重生成会让实时推送的关联键每次保存断一次。
 */
export function upsertBinding(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  binding: BindingPayload,
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => {
    const existing = node.bindings.find(
      (item) => item.fieldKey === binding.fieldKey,
    )
    const merged: BindingPayload =
      existing === undefined ? binding : { ...binding, id: existing.id }
    const kept = node.bindings.filter(
      (item) => item.fieldKey !== binding.fieldKey,
    )
    return { ...node, bindings: sortBindings([...kept, merged]) }
  })
}

/** 整批换掉一个节点的绑定（数组槽删行走它，行号要整体前移）。 */
export function setBindings(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  bindings: readonly BindingPayload[],
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => ({
    ...node,
    bindings: sortBindings([...bindings]),
  }))
}

/** 删一条绑定。 */
export function removeBinding(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
  fieldKey: string,
): DashboardNodePayload[] {
  return replaceNode(nodes, nodeId, (node) => ({
    ...node,
    bindings: node.bindings.filter((item) => item.fieldKey !== fieldKey),
  }))
}

/**
 * 绑定序 `(fieldKey, id)`，与服务端一致。
 * ⚠ 自己持有一份扁平绑定的编辑面（孪生子编辑器）也走它：各排各的序时，
 * 从两个入口改同一份绑定会在保存载荷里留下一整片纯顺序的假差异。
 */
export function sortBindings(
  bindings: readonly BindingPayload[],
): BindingPayload[] {
  return [...bindings].sort(
    (left, right) =>
      left.fieldKey.localeCompare(right.fieldKey) ||
      left.id.localeCompare(right.id),
  )
}

/** 两份节点表逐项同引用即视为没改动；配合不可变操作可当作零成本判等。 */
export function isSameNodeList(
  next: readonly DashboardNodePayload[],
  current: readonly DashboardNodePayload[],
): boolean {
  return (
    next.length === current.length &&
    next.every((node, at) => node === current[at])
  )
}

/**
 * 节点序 `(parentId, zIndex, id)`，与服务端返回的顺序一致。
 * ⚠ 顶层的 `parentId` 是 null，排在有父节点的前面——空串比任何 uuid 小。
 */
export function sortNodes(
  nodes: readonly DashboardNodePayload[],
): DashboardNodePayload[] {
  return [...nodes].sort(
    (left, right) =>
      (left.parentId ?? '').localeCompare(right.parentId ?? '') ||
      left.zIndex - right.zIndex ||
      left.id.localeCompare(right.id),
  )
}

/** 一条绑定的整树替换入参。 */
function toBindingInput(binding: BindingPayload): LayoutBindingInput {
  return {
    id: binding.id,
    field_key: binding.fieldKey,
    source_kind: binding.sourceKind,
    node_key: binding.nodeKey,
    static_value_json: binding.staticValueJson,
    compute_json: binding.computeJson,
    detail_json:
      binding.detailJson === null
        ? null
        : fromArchiveDetail(binding.detailJson),
    transform_json: binding.transformJson,
  }
}

/**
 * 整树替换的入参。
 * ⚠ 顺序原样沿用 `sortNodes`：后端按固定序返回，保存前后顺序一变，
 * Agent 就没法靠 diff 判断自己这一步改了什么。
 * @param nodes 当前草稿的全部节点
 */
export function toLayoutInput(
  nodes: readonly DashboardNodePayload[],
): LayoutNodeInput[] {
  return sortNodes(nodes).map((node) => ({
    id: node.id,
    parent_id: node.parentId,
    client_key: node.clientKey,
    module_type: node.moduleType,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z_index: node.zIndex,
    is_visible: node.isVisible,
    config_json: node.configJson,
    bindings: node.bindings.map(toBindingInput),
  }))
}

/**
 * 一份绑定里全部 `opcua` 绑定的点位身份，去重且定序。
 * ⚠ 排序不是为了好看：调用方按这串是否变化决定要不要重订，
 * 不定序的话每次求值都得到一串新次序，于是每次都白退订重订一遍。
 */
export function boundPointKeysOf(
  bindings: readonly BindingView[],
): readonly string[] {
  const keys = new Set<string>()
  for (const binding of bindings) {
    if (binding.sourceKind === 'opcua' && binding.nodeKey !== null) {
      keys.add(binding.nodeKey)
    }
  }
  return [...keys].sort()
}

/** 这张大屏上全部 `opcua` 绑定的点位身份，去重。收渲染子集，公开快照页也能用。 */
export function boundPointKeys(
  nodes: readonly Pick<DashboardNodeView, 'bindings'>[],
): readonly string[] {
  return boundPointKeysOf(nodes.flatMap((node) => node.bindings))
}
