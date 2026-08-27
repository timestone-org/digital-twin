/**
 * @fileoverview 节点实例的纯变更：增删改、复制、层序与对齐分布。三支 ops 共用的
 * 那几样——id 工厂、删除口径（`Twin2dRemoval`）、层序重排与盒算术——也落在这里，
 * 因为删节点是唯一会**级联**的一支（挂在它上头的连线跟着没），另两支各删各的；
 * 共用同一台差集与同一套盒算术，三处才不会漂出三种口径。
 *
 * ⚠ 一律纯函数：收一份 `Twin2dConfig` 出一份新的，不碰文档态、不碰选中态。
 * ⚠ 动不了的那些动作——点名的实体不在、已经到顶还要上移、只剩两只还要分布——一律
 *   **原样返回入参那个引用**：`twin2dDoc.commit` 按引用判「这一次要不要压一帧」，
 *   换了新引用却什么都没改，撤销键上就多出一格按了没反应的空步。
 * ⚠ 只有增、删、复制这三支经 `normalizeTwin2dConfig` 收口（引入新条目、会级联）；
 *   改值那一支**刻意不过归一化**——文本框是逐键写回的，归一化会把用户刚敲下的那个
 *   空格 trim 掉再写回 DOM，于是空格永远打不出来，而这一处零报错。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Pt, Twin2dConfig, Twin2dNode, Twin2dNodeStyle } from '@dt/twin2d'

import { nodeSnapBox } from './entityBoxes'
import type { Twin2dSnapBox } from './snapping'

/** 造实体 id 的工厂；可注入，测试里换成可预期的序列。 */
export type Twin2dIdFactory = (prefix: string) => string

/** 节点 id 的前缀。 */
export const TWIN_2D_NODE_ID_PREFIX = 'node'

/** id 尾巴上那段随机十六进制的位数。 */
const ID_RANDOM_LEN = 6

/** 造不出不重名 id 时改走序号之前，先随机试几轮。 */
const ID_ATTEMPTS = 100

/** 层序四档：置顶 / 上移一层 / 下移一层 / 置底。 */
export const TWIN_2D_ORDER_MOVES = [
  'front',
  'forward',
  'backward',
  'back',
] as const
export type Twin2dOrderMove = (typeof TWIN_2D_ORDER_MOVES)[number]

/** 对齐六档：三档横向、三档纵向。 */
export const TWIN_2D_ALIGN_EDGES = [
  'left',
  'hcenter',
  'right',
  'top',
  'vcenter',
  'bottom',
] as const
export type Twin2dAlignEdge = (typeof TWIN_2D_ALIGN_EDGES)[number]

/** 分布两档：横向等距、纵向等距。 */
export const TWIN_2D_DISTRIBUTE_AXES = ['x', 'y'] as const
export type Twin2dDistributeAxis = (typeof TWIN_2D_DISTRIBUTE_AXES)[number]

/** 不动；不每次现造一个，免得下游的按值比对白判一遍。 */
const ZERO_DELTA: Pt = Object.freeze({ x: 0, y: 0 })

/** 一条都没删掉；三支 ops 共用同一个，免得下游的按值比对白判一遍。 */
export const TWIN_2D_NOTHING_REMOVED: Twin2dRemovedIds = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  marks: Object.freeze([]),
})

/**
 * 一次删除之后没了的 id，按类分。
 * ⚠ 三类都给（哪怕两类恒空）：调用方要拿它去 `prune` 选中态、去看绑定被搬到哪，
 * 而删节点会连带删掉连线——按类分的表才说得出「你删了 1 个节点、3 条线」。
 */
export interface Twin2dRemovedIds {
  nodes: readonly string[]
  edges: readonly string[]
  marks: readonly string[]
}

/** 删除的结果：新配置，加这次没了的 id。 */
export interface Twin2dRemoval {
  config: Twin2dConfig
  removed: Twin2dRemovedIds
}

/** 新增/复制的结果：新配置，加新条目的 id；没能落地时 id 为 null。 */
export interface Twin2dAdded {
  config: Twin2dConfig
  id: string | null
}

/** 批量复制的结果：新配置，加各份副本的 id（文档序）。 */
export interface Twin2dCopied {
  config: Twin2dConfig
  ids: readonly string[]
}

/**
 * 造一个实体 id：前缀加一段随机十六进制。
 * ⚠ 不用「现有条数 + 1」：删掉中间一条之后它会与尚存的某一条重名，而重名在渲染层
 * 表现为两个实体抢同一份实时值，界面上看不出是重名造成的。
 * ⚠ 取值来自 `Math.random`，只做本地标识，不做任何安全用途。
 * @param prefix id 前缀
 */
export function newTwin2dId(prefix: string): string {
  const random = Math.random()
    .toString(16)
    .slice(2, 2 + ID_RANDOM_LEN)
    .padEnd(ID_RANDOM_LEN, '0')
  return `${prefix}-${random}`
}

/**
 * 造一个在 `taken` 里不重名的 id。
 * @param prefix id 前缀
 * @param taken 已经占用的 id
 * @param makeId id 工厂，缺省随机
 */
export function freshTwin2dId(
  prefix: string,
  taken: ReadonlySet<string>,
  makeId: Twin2dIdFactory = newTwin2dId,
): string {
  for (let attempt = 0; attempt < ID_ATTEMPTS; attempt += 1) {
    const candidate = makeId(prefix)
    if (!taken.has(candidate)) return candidate
  }
  // 注入的 id 工厂只给固定值时才走到这里；改走序号，序号本身也要避开已用的
  let index = taken.size
  while (taken.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

/** 一张表里现有的全部 id。 */
function idsOf(list: readonly { id: string }[]): Set<string> {
  return new Set(list.map((item) => item.id))
}

/** 前一份里有、后一份里没了的那些 id。 */
function goneIds(
  before: readonly { id: string }[],
  after: readonly { id: string }[],
): readonly string[] {
  const kept = idsOf(after)
  return before.filter((item) => !kept.has(item.id)).map((item) => item.id)
}

/**
 * 前后两份配置的差集：这一次没了哪些 id。
 * ⚠ 按前后对比算，不按调用方点名的那批 id 算：删一个节点会把挂在它上头的连线一起
 * 带走（归一化丢弃悬空端点的整条线），只报被点名的那几个，选中态就会停在一条已经
 * 不存在的连线上——右栏照常画着它，改哪一项都写不回去且不报错。
 * @param before 删之前那一份
 * @param after 删之后那一份
 */
export function twin2dRemoval(
  before: Twin2dConfig,
  after: Twin2dConfig,
): Twin2dRemoval {
  return {
    config: after,
    removed: {
      nodes: goneIds(before.nodes, after.nodes),
      edges: goneIds(before.edges, after.edges),
      marks: goneIds(before.marks, after.marks),
    },
  }
}

/** 两张表是不是逐位同一个对象。 */
function sameOrder<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  )
}

/** 被选中的整体往后挪一格（越靠后越压在上面）。 */
function stepForward<T extends { id: string }>(
  list: readonly T[],
  picked: ReadonlySet<string>,
): T[] {
  const next = [...list]
  for (let index = next.length - 2; index >= 0; index -= 1) {
    const here = next[index]
    const above = next[index + 1]
    if (here === undefined || above === undefined) continue
    if (!picked.has(here.id) || picked.has(above.id)) continue
    next[index] = above
    next[index + 1] = here
  }
  return next
}

/** 被选中的整体往前挪一格。 */
function stepBackward<T extends { id: string }>(
  list: readonly T[],
  picked: ReadonlySet<string>,
): T[] {
  const next = [...list]
  for (let index = 1; index < next.length; index += 1) {
    const here = next[index]
    const below = next[index - 1]
    if (here === undefined || below === undefined) continue
    if (!picked.has(here.id) || picked.has(below.id)) continue
    next[index] = below
    next[index - 1] = here
  }
  return next
}

/** 四档层序各自怎么重排。 */
function reorder<T extends { id: string }>(
  list: readonly T[],
  picked: ReadonlySet<string>,
  move: Twin2dOrderMove,
): T[] {
  const inside = list.filter((item) => picked.has(item.id))
  const outside = list.filter((item) => !picked.has(item.id))
  if (move === 'front') return [...outside, ...inside]
  if (move === 'back') return [...inside, ...outside]
  return move === 'forward'
    ? stepForward(list, picked)
    : stepBackward(list, picked)
}

/**
 * 层序重排：一批一起动，批内的相对次序保持不变；一步都没挪时原样返回入参。
 * ⚠ 文档序不只是绘制序（后面的压在前面的上头），也是数组绑定的行号：动一次层序
 * 就等于把它与相邻那条的取值来源对调，所以调用方必须走 `commit` 让绑定跟着重派。
 * @param list 整张表
 * @param ids 要动的那一批
 * @param move 四档层序
 */
export function orderList<T extends { id: string }>(
  list: readonly T[],
  ids: readonly string[],
  move: Twin2dOrderMove,
): readonly T[] {
  const next = reorder(list, new Set(ids), move)
  return sameOrder(list, next) ? list : next
}

/** 一批盒的外接范围。 */
interface Extent {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** 一批盒的外接范围；一个盒都没有时 null。 */
function extentOf(boxes: readonly Twin2dSnapBox[]): Extent | null {
  const first = boxes[0]
  if (first === undefined) return null
  const extent: Extent = {
    minX: first.x,
    maxX: first.x + first.w,
    minY: first.y,
    maxY: first.y + first.h,
  }
  for (const box of boxes) {
    extent.minX = Math.min(extent.minX, box.x)
    extent.maxX = Math.max(extent.maxX, box.x + box.w)
    extent.minY = Math.min(extent.minY, box.y)
    extent.maxY = Math.max(extent.maxY, box.y + box.h)
  }
  return extent
}

/** 一只盒往哪个方向挪多少才对齐。 */
function alignDelta(
  box: Twin2dSnapBox,
  extent: Extent,
  edge: Twin2dAlignEdge,
): Pt {
  switch (edge) {
    case 'left':
      return { x: extent.minX - box.x, y: 0 }
    case 'right':
      return { x: extent.maxX - box.w - box.x, y: 0 }
    case 'hcenter':
      return { x: (extent.minX + extent.maxX - box.w) / 2 - box.x, y: 0 }
    case 'top':
      return { x: 0, y: extent.minY - box.y }
    case 'bottom':
      return { x: 0, y: extent.maxY - box.h - box.y }
    default:
      return { x: 0, y: (extent.minY + extent.maxY - box.h) / 2 - box.y }
  }
}

/**
 * 一批盒各自的对齐位移，与入参同序。
 * ⚠ 基准是这一批**自己的外接盒**，不是画布：按画布对齐会把两个挨着的节点甩到
 * 屏幕两侧去，而那从来不是「对齐」这个动作的意思。
 * @param boxes 这一批的包围盒（设计坐标）
 * @param edge 对齐到哪一边
 */
export function alignDeltas(
  boxes: readonly Twin2dSnapBox[],
  edge: Twin2dAlignEdge,
): readonly Pt[] {
  const extent = extentOf(boxes)
  if (extent === null) return []
  return boxes.map((box) => alignDelta(box, extent, edge))
}

/** 一只盒在这条轴上的起点与长度。 */
function spanOn(
  box: Twin2dSnapBox,
  axis: Twin2dDistributeAxis,
): readonly [number, number] {
  return axis === 'x' ? [box.x, box.w] : [box.y, box.h]
}

/**
 * 一批盒各自的等距位移，与入参同序。
 * ⚠ 两端那两只**不动**，中间的按「盒与盒之间的缝一样宽」摆：按中心等距会让宽窄
 * 不一的一排看着仍然挤在一头，而那正是用户按这个键要解决的事。
 * ⚠ 少于三只时一步都不挪：两只之间没有「中间」可分。
 * @param boxes 这一批的包围盒（设计坐标）
 * @param axis 沿哪条轴分布
 */
export function distributeDeltas(
  boxes: readonly Twin2dSnapBox[],
  axis: Twin2dDistributeAxis,
): readonly Pt[] {
  const order = boxes
    .map((box, index) => ({ index, span: spanOn(box, axis) }))
    .sort((left, right) => left.span[0] - right.span[0])
  const head = order[0]
  const tail = order[order.length - 1]
  if (head === undefined || tail === undefined || order.length < 3) {
    return boxes.map(() => ZERO_DELTA)
  }
  const used = order.reduce((sum, entry) => sum + entry.span[1], 0)
  const reach = tail.span[0] + tail.span[1] - head.span[0]
  const gap = (reach - used) / (order.length - 1)
  const deltas: Pt[] = boxes.map(() => ZERO_DELTA)
  let cursor = head.span[0]
  for (const entry of order) {
    const shift = cursor - entry.span[0]
    deltas[entry.index] = axis === 'x' ? { x: shift, y: 0 } : { x: 0, y: shift }
    cursor += entry.span[1] + gap
  }
  return deltas
}

/** 一批 id 与它们各自的位移。 */
function deltaMap(
  ids: readonly string[],
  deltas: readonly Pt[],
): ReadonlyMap<string, Pt> {
  return new Map(ids.map((id, index) => [id, deltas[index] ?? ZERO_DELTA]))
}

/** 这一批位移全是 0。 */
function isStill(deltas: ReadonlyMap<string, Pt>): boolean {
  return [...deltas.values()].every((at) => at.x === 0 && at.y === 0)
}

/**
 * 被点名且样式寻得到的那些节点，连同它们在画布上占的盒（文档序）。
 * ⚠ 样式悬空的节点排掉：它在画面上本来就没有盒，把它算进外接范围会让整批对到一个
 * 谁都看不见的边上。
 */
function pickedNodeBoxes(
  nodes: readonly Twin2dNode[],
  ids: readonly string[],
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
): { ids: readonly string[]; boxes: readonly Twin2dSnapBox[] } {
  const picked = new Set(ids)
  const keptIds: string[] = []
  const boxes: Twin2dSnapBox[] = []
  for (const node of nodes) {
    const style = styles.get(node.styleId)
    if (!picked.has(node.id) || style === undefined) continue
    keptIds.push(node.id)
    boxes.push(nodeSnapBox(node, style))
  }
  return { ids: keptIds, boxes }
}

/** 按 id 给节点加位移；一步都没挪时原样返回入参那份配置。 */
function withNodeDeltas(
  config: Twin2dConfig,
  ids: readonly string[],
  deltas: readonly Pt[],
): Twin2dConfig {
  const map = deltaMap(ids, deltas)
  if (isStill(map)) return config
  return {
    ...config,
    nodes: config.nodes.map((node) => {
      const at = map.get(node.id)
      if (at === undefined || (at.x === 0 && at.y === 0)) return node
      return { ...node, x: node.x + at.x, y: node.y + at.y }
    }),
  }
}

/**
 * 新增一个节点，追加在末尾（= 画在最上层）。
 * ⚠ 种子只给要紧的几项，其余交给归一化补缺省：在这里抄一份缺省值，抄的那份一旦与
 * 归一化不一致，新建的节点会在「存一次再读回来」之后悄悄变样。
 * ⚠ 归一化丢掉这一条时（种子脏到没有身份）交出的是**原样的配置**与 `id: null`：
 * 交一个落不到实处的 id 出去，调用方会拿它去选中一个不存在的东西。
 * @param config 当前配置
 * @param seed 新节点的种子（至少给 `styleId`）
 * @param makeId id 工厂，缺省随机
 */
export function addNode(
  config: Twin2dConfig,
  seed: Partial<Omit<Twin2dNode, 'id'>>,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const id = freshTwin2dId(TWIN_2D_NODE_ID_PREFIX, idsOf(config.nodes), makeId)
  const next = normalizeTwin2dConfig({
    ...config,
    nodes: [...config.nodes, { ...seed, id }],
  })
  const landed = next.nodes.some((node) => node.id === id)
  return landed ? { config: next, id } : { config, id: null }
}

/**
 * 改一个节点的若干字段；节点不在就原样返回入参那份配置。
 * ⚠ `id` 不在可改之列：改 id 等于把这个节点换成另一个，而挂在它上头的连线端点与
 * 绑定行都还指着旧的那一个，三处一起静默失联。
 * ⚠ 节点在就一律换新引用，哪怕补丁里的值与原值相同：检查器用 `commitMerged` 把连续
 * 输入并成一帧，所以这一格空步不会把撤销栈撑爆，而在这里逐字段深比对反而更贵。
 * @param config 当前配置
 * @param id 要改的节点
 * @param patch 要覆盖的字段
 */
export function updateNode(
  config: Twin2dConfig,
  id: string,
  patch: Partial<Omit<Twin2dNode, 'id'>>,
): Twin2dConfig {
  if (!config.nodes.some((node) => node.id === id)) return config
  return {
    ...config,
    nodes: config.nodes.map((node) =>
      node.id === id ? { ...node, ...patch } : node,
    ),
  }
}

/**
 * 复制一批节点，每份副本插在它自己后面。
 * ⚠ 挂在原节点上的连线**不跟着复制**：连线的两端认的是节点 id，跟着复制就得同时
 * 决定「副本之间的线」还是「副本连到原件」，而两种都不是用户按下这个键时想的事。
 * ⚠ 副本不改显示名：2D 图上的节点常常压根没有显示名，凭空补一个「副本」会在图上
 * 多出一行字。
 * @param config 当前配置
 * @param ids 要复制的那一批
 * @param offset 副本相对原件的位移（设计坐标）
 * @param makeId id 工厂，缺省随机
 */
export function duplicateNodes(
  config: Twin2dConfig,
  ids: readonly string[],
  offset: Pt,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dCopied {
  const picked = new Set(ids)
  const taken = idsOf(config.nodes)
  const copies: string[] = []
  const nodes: Twin2dNode[] = []
  for (const node of config.nodes) {
    nodes.push(node)
    if (!picked.has(node.id)) continue
    const id = freshTwin2dId(TWIN_2D_NODE_ID_PREFIX, taken, makeId)
    taken.add(id)
    copies.push(id)
    nodes.push({ ...node, id, x: node.x + offset.x, y: node.y + offset.y })
  }
  if (copies.length === 0) return { config, ids: [] }
  return { config: normalizeTwin2dConfig({ ...config, nodes }), ids: copies }
}

/**
 * 删掉一批节点，挂在它们上头的连线跟着没。
 * ⚠ 连线是**归一化**丢的（悬空端点整条丢），不在这里另写一遍：另写的那一份一旦与
 * 归一化的判据漂开，就会剩下一条通向不存在节点的线，而它在画面上是从节点中心横穿
 * 出去的一道，看着像走线算错了。
 * @param config 当前配置
 * @param ids 要删的那一批
 */
export function removeNodes(
  config: Twin2dConfig,
  ids: readonly string[],
): Twin2dRemoval {
  const doomed = new Set(ids)
  const kept = config.nodes.filter((node) => !doomed.has(node.id))
  if (kept.length === config.nodes.length) {
    return { config, removed: TWIN_2D_NOTHING_REMOVED }
  }
  return twin2dRemoval(
    config,
    normalizeTwin2dConfig({ ...config, nodes: kept }),
  )
}

/**
 * 调一批节点的层序。
 * @param config 当前配置
 * @param ids 要动的那一批
 * @param move 四档层序
 */
export function orderNodes(
  config: Twin2dConfig,
  ids: readonly string[],
  move: Twin2dOrderMove,
): Twin2dConfig {
  const nodes = orderList(config.nodes, ids, move)
  return nodes === config.nodes ? config : { ...config, nodes }
}

/**
 * 把一批节点对到同一条边上。
 * @param config 当前配置
 * @param ids 要对齐的那一批
 * @param styles 按 id 取节点样式（文档 ∪ 预置库，调用方合并好）
 * @param edge 对齐到哪一边
 */
export function alignNodes(
  config: Twin2dConfig,
  ids: readonly string[],
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
  edge: Twin2dAlignEdge,
): Twin2dConfig {
  const picked = pickedNodeBoxes(config.nodes, ids, styles)
  return withNodeDeltas(config, picked.ids, alignDeltas(picked.boxes, edge))
}

/**
 * 把一批节点沿一条轴摆成等距。
 * @param config 当前配置
 * @param ids 要分布的那一批
 * @param styles 按 id 取节点样式（文档 ∪ 预置库，调用方合并好）
 * @param axis 沿哪条轴
 */
export function distributeNodes(
  config: Twin2dConfig,
  ids: readonly string[],
  styles: ReadonlyMap<string, Twin2dNodeStyle>,
  axis: Twin2dDistributeAxis,
): Twin2dConfig {
  const picked = pickedNodeBoxes(config.nodes, ids, styles)
  return withNodeDeltas(
    config,
    picked.ids,
    distributeDeltas(picked.boxes, axis),
  )
}
