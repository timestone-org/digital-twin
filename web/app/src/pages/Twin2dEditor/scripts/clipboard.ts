/**
 * @fileoverview 2D 孪生编辑器的剪贴板：把选中的节点 / 连线 / 标注，或样式里的一批
 * 图元，打成一份载荷；粘贴时全部重发 id 落回文档。内存与 localStorage 两个通道，
 * 同一个浏览器里换一张图也粘得出来。
 *
 * ⚠ 粘贴一律**重发 id**：沿用原 id 的话节点级覆盖补丁、变体补丁与连线端点都会寻址到
 *   原件，改副本时原件跟着变，而这三处一个都不报错。
 * ⚠ 复制一批节点只带走**两端都在这一批里**的连线：带走半截的那些粘出来是悬空线，
 *   归一化把整条丢掉，用户看到的是「连线没了」。
 * ⚠ 用到的**文档级**样式跟着载荷走，预置库里那些不带：预置样式在每张图上都有，抄一份
 *   进目标图等于把这一版预置就地写死，将来预置升级再也修不到这张图（同「恢复内置是删
 *   覆盖」那条口径）。同 id 时以目标图为准（§13.4），并把带入 / 沿用 / 仍缺三档如实报
 *   给调用方——闷声换一份样式的后果是整批节点粘完变了样，而画面上无从追查。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  TWIN_2D_DEFAULT_GRID,
  TWIN_2D_EDGE_PRESETS,
  isRecord,
  normalizeEdgeStyles,
  normalizeEdges,
  normalizeMarks,
  normalizeNodeStyles,
  normalizeNodes,
  normalizePrims,
  normalizeTwin2dConfig,
  stringList,
} from '@dt/twin2d'
import type {
  Pt,
  Twin2dConfig,
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dEndpoint,
  Twin2dMark,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dPrim,
} from '@dt/twin2d'

import { TWIN_2D_EDGE_ID_PREFIX, removeEdges } from './edgeOps'
import { TWIN_2D_MARK_ID_PREFIX, removeMarks } from './markOps'
import {
  TWIN_2D_NODE_ID_PREFIX,
  freshTwin2dId,
  newTwin2dId,
  removeNodes,
} from './nodeOps'
import { TWIN_2D_PRIM_ID_PREFIX, remintTwin2dPrim } from './primOps'
import type { Twin2dPickKind } from './editorSelection'
import type { Twin2dPrimReseed } from './primOps'
import type { Twin2dIdFactory, Twin2dRemoval } from './nodeOps'

/** 载荷形状的版本；形状一变就加一，读到别的版本一律当没有。 */
const TWIN_2D_CLIPBOARD_VERSION = 1

/** localStorage 上的键；换一张图、换一个标签页都读同一份。 */
export const TWIN_2D_CLIPBOARD_KEY = 'dt.twin2d.clipboard'

/** 一份实体载荷：三类实例，加它们用到的文档级样式。 */
export interface Twin2dEntityClip {
  kind: 'entities'
  version: number
  /** 复制时刻；两个通道之间只用来比新旧。 */
  stampMs: number
  nodes: readonly Twin2dNode[]
  edges: readonly Twin2dEdge[]
  marks: readonly Twin2dMark[]
  /**
   * 载荷里这些连线两端点到的节点 id，含**不在载荷里**的那些。
   * ⚠ 少了它，只复制连线的那一份从 localStorage 读回来时会被悬空过滤整批丢掉，
   * 于是「复制一条线再粘一份」这件事只在不刷新页面时成立。
   */
  edgeNodeIds: readonly string[]
  styles: readonly Twin2dNodeStyle[]
  edgeStyles: readonly Twin2dEdgeStyle[]
}

/** 一份图元载荷：样式图元树上的一批子树。 */
export interface Twin2dPrimClip {
  kind: 'prims'
  version: number
  stampMs: number
  prims: readonly Twin2dPrim[]
}

/** 剪贴板里装的那一份。 */
export type Twin2dClip = Twin2dEntityClip | Twin2dPrimClip

/** 一次粘贴新落地的 id，按类分。 */
export interface Twin2dPastedIds {
  nodes: readonly string[]
  edges: readonly string[]
  marks: readonly string[]
}

/** 一次粘贴的样式去向：带进本图的、沿用本图同 id 的、仍然寻不到的。 */
export interface Twin2dStyleCarry {
  added: readonly string[]
  adopted: readonly string[]
  /** 本图没有、载荷没带、预置库也没有；调用方据此提示这些样式在本图里不存在。 */
  missing: readonly string[]
}

/** 一次实体粘贴的结果。 */
export interface Twin2dPasted {
  config: Twin2dConfig
  ids: Twin2dPastedIds
  styles: Twin2dStyleCarry
  edgeStyles: Twin2dStyleCarry
  /** 两端在本图里都寻不到、整条没粘上的连线数。 */
  droppedEdges: number
}

/** 取时刻的钟；可注入，测试里换成可预期的序列。 */
export type Twin2dClock = () => number

/** 一张表里现有的全部 id。 */
function idsOf(list: readonly { id: string }[]): Set<string> {
  return new Set(list.map((item) => item.id))
}

/**
 * 这一次要跟着走的连线。
 * @param edges 整份连线表
 * @param kind 选中的是哪一类
 * @param picked 被点名的那一批
 * @param nodeIds 跟着走的节点 id
 */
function clipEdges(
  edges: readonly Twin2dEdge[],
  kind: Twin2dPickKind,
  picked: ReadonlySet<string>,
  nodeIds: ReadonlySet<string>,
): readonly Twin2dEdge[] {
  if (kind === 'edges') return edges.filter((edge) => picked.has(edge.id))
  if (kind !== 'nodes') return []
  return edges.filter(
    (edge) => nodeIds.has(edge.from.nodeId) && nodeIds.has(edge.to.nodeId),
  )
}

/** 一批连线两端点到的节点 id，去重。 */
function endpointIds(edges: readonly Twin2dEdge[]): readonly string[] {
  return [
    ...new Set(edges.flatMap((edge) => [edge.from.nodeId, edge.to.nodeId])),
  ]
}

/**
 * 打一份实体载荷；一条都没选中时给 null。
 * @param config 当前配置
 * @param kind 选中的是哪一类
 * @param ids 被点名的那一批
 * @param now 取时刻的钟
 */
export function twin2dEntityClip(
  config: Twin2dConfig,
  kind: Twin2dPickKind,
  ids: readonly string[],
  now: Twin2dClock = Date.now,
): Twin2dEntityClip | null {
  const picked = new Set(ids)
  const nodes =
    kind === 'nodes' ? config.nodes.filter((node) => picked.has(node.id)) : []
  const marks =
    kind === 'marks' ? config.marks.filter((mark) => picked.has(mark.id)) : []
  const edges = clipEdges(config.edges, kind, picked, idsOf(nodes))
  if (nodes.length + edges.length + marks.length === 0) return null
  const styleIds = new Set(nodes.map((node) => node.styleId))
  const edgeStyleIds = new Set(edges.map((edge) => edge.styleId))
  return {
    kind: 'entities',
    version: TWIN_2D_CLIPBOARD_VERSION,
    stampMs: now(),
    nodes,
    edges,
    marks,
    edgeNodeIds: endpointIds(edges),
    styles: config.styles.filter((style) => styleIds.has(style.id)),
    edgeStyles: config.edgeStyles.filter((style) => edgeStyleIds.has(style.id)),
  }
}

/** 三类实例各自的删除口径；剪切按选中那一类走对应的一支。 */
const REMOVERS: Readonly<
  Record<
    Twin2dPickKind,
    (config: Twin2dConfig, ids: readonly string[]) => Twin2dRemoval
  >
> = {
  nodes: removeNodes,
  edges: removeEdges,
  marks: removeMarks,
}

/** 一次剪切：先打包，再删。 */
export interface Twin2dCut {
  clip: Twin2dEntityClip | null
  removal: Twin2dRemoval
}

/**
 * 剪切一批实体。
 * ⚠ 顺序不能反：删节点会把挂在它上头的连线一起带走，先删再打包的话载荷里就少了
 * 那几条线，粘回来是一堆互不相连的节点，而这一步零报错。
 * @param config 当前配置
 * @param kind 选中的是哪一类
 * @param ids 被点名的那一批
 * @param now 取时刻的钟
 */
export function twin2dCut(
  config: Twin2dConfig,
  kind: Twin2dPickKind,
  ids: readonly string[],
  now: Twin2dClock = Date.now,
): Twin2dCut {
  const clip = twin2dEntityClip(config, kind, ids, now)
  return { clip, removal: REMOVERS[kind](config, ids) }
}

/** 一批条目重发 id 之后的副本，与新旧 id 的对照。 */
interface Reissued<T> {
  list: readonly T[]
  ids: ReadonlyMap<string, string>
}

/**
 * 一批条目各发一个新 id 并原样克隆；`taken` 就地记账，同一次粘贴里不会互相撞。
 * ⚠ 副本与对照表一趟出：分两趟做的话中间那张表要靠 id 反查，而反查不到的那一支
 * 是构造上走不到的死分支，读的人却得逐个确认它走不到。
 * @param items 要重发 id 的条目
 * @param prefix id 前缀
 * @param taken 已经占用的 id
 * @param makeId id 工厂
 */
function reissue<T extends { id: string }>(
  items: readonly T[],
  prefix: string,
  taken: Set<string>,
  makeId: Twin2dIdFactory,
): Reissued<T> {
  const ids = new Map<string, string>()
  const list: T[] = []
  for (const item of items) {
    const id = freshTwin2dId(prefix, taken, makeId)
    taken.add(id)
    ids.set(item.id, id)
    list.push({ ...item, id })
  }
  return { list, ids }
}

/** 整个节点平移。 */
function movedNode(node: Twin2dNode, at: Pt): Twin2dNode {
  return { ...node, x: node.x + at.x, y: node.y + at.y }
}

/** 整条标注平移；辅助线的第二个端点是绝对坐标，得跟着一起挪。 */
function movedMark(mark: Twin2dMark, at: Pt): Twin2dMark {
  return {
    ...mark,
    x: mark.x + at.x,
    y: mark.y + at.y,
    x2: mark.x2 + at.x,
    y2: mark.y2 + at.y,
  }
}

/** 一个端点落到哪：`moved` 为真即它接的是这次粘出来的副本。 */
interface PastedEnd {
  at: Twin2dEndpoint
  moved: boolean
}

/**
 * 一个端点粘完接谁：跟着一起粘的节点换成副本，没跟着的留在原节点上；
 * 原节点在本图里也寻不到时给 null（整条线作废）。
 * @param end 原端点
 * @param nodeIds 这次粘贴的节点 id 映射
 * @param alive 粘完之后本图里所有的节点 id
 */
function pastedEnd(
  end: Twin2dEndpoint,
  nodeIds: ReadonlyMap<string, string>,
  alive: ReadonlySet<string>,
): PastedEnd | null {
  const mapped = nodeIds.get(end.nodeId)
  if (mapped !== undefined)
    return { at: { ...end, nodeId: mapped }, moved: true }
  return alive.has(end.nodeId) ? { at: end, moved: false } : null
}

/** 落地连线要的三样东西，加位移。 */
interface EdgePasteInput {
  /** 已经换过 id 的连线副本。 */
  edges: readonly Twin2dEdge[]
  nodeIds: ReadonlyMap<string, string>
  /** 粘完之后本图里所有的节点 id。 */
  alive: ReadonlySet<string>
  offset: Pt
}

/**
 * 落地的连线，加上因两端都寻不到而整条作废的条数。
 * ⚠ 拐点只在**两端都是这次的副本**时才跟着加位移：一端仍挂在原节点上的那条线
 * 位置根本没动，给拐点加位移等于凭空把它拽成一道折线。
 * @param input 连线副本、节点 id 映射、本图现有节点 id 与位移
 */
function pastedEdges(input: EdgePasteInput): {
  edges: Twin2dEdge[]
  dropped: number
} {
  const kept: Twin2dEdge[] = []
  let dropped = 0
  for (const edge of input.edges) {
    const from = pastedEnd(edge.from, input.nodeIds, input.alive)
    const to = pastedEnd(edge.to, input.nodeIds, input.alive)
    if (from === null || to === null) {
      dropped += 1
      continue
    }
    const inside = from.moved && to.moved
    kept.push({
      ...edge,
      from: from.at,
      to: to.at,
      waypoints: inside
        ? edge.waypoints.map((at) => ({
            x: at.x + input.offset.x,
            y: at.y + input.offset.y,
          }))
        : edge.waypoints,
    })
  }
  return { edges: kept, dropped }
}

/** 带样式过来要的四样东西。 */
interface CarryInput<T extends { id: string }> {
  /** 载荷里带过来的那些。 */
  carried: readonly T[]
  /** 本图现有的那些。 */
  own: readonly T[]
  /** 粘进来的实体引用到的样式 id。 */
  used: ReadonlySet<string>
  /** 这个 id 在预置库里有没有。 */
  isBuiltin: (id: string) => boolean
}

/**
 * 把载荷里的样式并进本图。
 * ⚠ 同 id 一律沿用**本图**那份，不覆盖：覆盖会把本图里所有用这个样式的节点一起改样，
 * 而用户以为自己只是粘了一个节点。
 * @param input 两边的样式表、用到的 id 与预置库判定
 */
function carryStyles<T extends { id: string }>(
  input: CarryInput<T>,
): { list: readonly T[]; carry: Twin2dStyleCarry } {
  const own = new Set(input.own.map((style) => style.id))
  const added: T[] = []
  const adopted: string[] = []
  for (const style of input.carried) {
    if (!input.used.has(style.id)) continue
    if (own.has(style.id)) {
      adopted.push(style.id)
      continue
    }
    added.push(style)
    own.add(style.id)
  }
  const missing = [...input.used].filter(
    (id) => !own.has(id) && !input.isBuiltin(id),
  )
  return {
    list: added.length === 0 ? input.own : [...input.own, ...added],
    carry: { added: added.map((style) => style.id), adopted, missing },
  }
}

/** 归一化之后仍在的那些 id：交一个落不到实处的 id 出去，调用方会拿它去选中。 */
function landedIds(
  config: Twin2dConfig,
  wanted: Twin2dPastedIds,
): Twin2dPastedIds {
  const keep = (
    list: readonly { id: string }[],
    ids: readonly string[],
  ): readonly string[] => {
    const alive = idsOf(list)
    return ids.filter((id) => alive.has(id))
  }
  return {
    nodes: keep(config.nodes, wanted.nodes),
    edges: keep(config.edges, wanted.edges),
    marks: keep(config.marks, wanted.marks),
  }
}

/** 一次实体粘贴要交代的四件事。 */
export interface Twin2dPasteInput {
  config: Twin2dConfig
  clip: Twin2dEntityClip
  /** 副本相对原件的位移（设计坐标）。 */
  offset: Pt
  makeId?: Twin2dIdFactory
}

/** 三类各自重发 id 之后的副本与对照。 */
interface PasteCopies {
  nodes: Reissued<Twin2dNode>
  edges: Reissued<Twin2dEdge>
  marks: Reissued<Twin2dMark>
}

/**
 * 三类实例各克隆一份、各发一份新 id。
 * ⚠ 三张表各自记账即可：id 前缀分了类，跨类不会撞。
 * @param clip 载荷
 * @param config 当前配置
 * @param makeId id 工厂
 */
function pasteCopies(
  clip: Twin2dEntityClip,
  config: Twin2dConfig,
  makeId: Twin2dIdFactory,
): PasteCopies {
  return {
    nodes: reissue(
      clip.nodes,
      TWIN_2D_NODE_ID_PREFIX,
      idsOf(config.nodes),
      makeId,
    ),
    edges: reissue(
      clip.edges,
      TWIN_2D_EDGE_ID_PREFIX,
      idsOf(config.edges),
      makeId,
    ),
    marks: reissue(
      clip.marks,
      TWIN_2D_MARK_ID_PREFIX,
      idsOf(config.marks),
      makeId,
    ),
  }
}

/** 两类样式各自并进本图之后的表与去向。 */
interface PasteStyles {
  styles: { list: readonly Twin2dNodeStyle[]; carry: Twin2dStyleCarry }
  edgeStyles: { list: readonly Twin2dEdgeStyle[]; carry: Twin2dStyleCarry }
}

/**
 * 两类样式一起并进本图。
 * ⚠ 连线样式按**真正落地**的那几条线算，不按载荷里的：整条作废的线不该把它的样式
 * 也带进本图，那会在样式库里留下一个没人用的条目。
 * @param clip 载荷
 * @param config 当前配置
 * @param edges 真正落地的连线
 */
function pasteStyles(
  clip: Twin2dEntityClip,
  config: Twin2dConfig,
  edges: readonly Twin2dEdge[],
): PasteStyles {
  return {
    styles: carryStyles({
      carried: clip.styles,
      own: config.styles,
      used: new Set(clip.nodes.map((node) => node.styleId)),
      isBuiltin: (id) => TWIN_2D_BUILTIN_NODE_STYLE_MAP.has(id),
    }),
    edgeStyles: carryStyles({
      carried: clip.edgeStyles,
      own: config.edgeStyles,
      used: new Set(edges.map((edge) => edge.styleId)),
      isBuiltin: (id) => TWIN_2D_EDGE_PRESETS.some((style) => style.id === id),
    }),
  }
}

/**
 * 把一份实体载荷粘进配置：三类各自重发 id，连线端点跟着重指，用到的样式一并并入。
 * @param input 配置、载荷、位移与 id 工厂
 */
export function pasteTwin2dEntities(input: Twin2dPasteInput): Twin2dPasted {
  const { config, clip, offset } = input
  const copies = pasteCopies(clip, config, input.makeId ?? newTwin2dId)
  const nodes = [
    ...config.nodes,
    ...copies.nodes.list.map((node) => movedNode(node, offset)),
  ]
  const marks = [
    ...config.marks,
    ...copies.marks.list.map((mark) => movedMark(mark, offset)),
  ]
  const drawn = pastedEdges({
    edges: copies.edges.list,
    nodeIds: copies.nodes.ids,
    alive: idsOf(nodes),
    offset,
  })
  const carried = pasteStyles(clip, config, drawn.edges)
  const next = normalizeTwin2dConfig({
    ...config,
    styles: carried.styles.list,
    edgeStyles: carried.edgeStyles.list,
    nodes,
    edges: [...config.edges, ...drawn.edges],
    marks,
  })
  return {
    config: next,
    ids: landedIds(next, {
      nodes: [...copies.nodes.ids.values()],
      edges: [...copies.edges.ids.values()],
      marks: [...copies.marks.ids.values()],
    }),
    styles: carried.styles.carry,
    edgeStyles: carried.edgeStyles.carry,
    droppedEdges: drawn.dropped,
  }
}

/**
 * 打一份图元载荷；一个都没给时 null。
 * @param prims 要复制的那几棵子树
 * @param now 取时刻的钟
 */
export function twin2dPrimClip(
  prims: readonly Twin2dPrim[],
  now: Twin2dClock = Date.now,
): Twin2dPrimClip | null {
  if (prims.length === 0) return null
  return {
    kind: 'prims',
    version: TWIN_2D_CLIPBOARD_VERSION,
    stampMs: now(),
    prims,
  }
}

/**
 * 粘贴：新 id 一律从通用前缀起。
 * ⚠ 载荷可能来自另一份样式甚至另一张大屏，原 id 在这里没有含义；再制那一档才从原 id
 * 起（见 `primOps` 的 `RESEED_FROM_SELF`）。发号那一趟两边共用 `remintTwin2dPrim`。
 */
const RESEED_FRESH: Twin2dPrimReseed = () => TWIN_2D_PRIM_ID_PREFIX

/** 一次图元粘贴要交代的四件事。 */
export interface Twin2dPrimPasteInput {
  /** 要粘进去的那张表：样式的顶层图元，或某个 box 的子树。 */
  list: readonly Twin2dPrim[]
  clip: Twin2dPrimClip
  /** 整份样式里已经占用的图元 id（含所有层级），由 `primOps` 的 `twin2dPrimIds` 收。 */
  taken: ReadonlySet<string>
  makeId?: Twin2dIdFactory
}

/** 一次图元粘贴的结果。 */
export interface Twin2dPrimsPasted {
  list: readonly Twin2dPrim[]
  /** 落地的顶层副本 id（文档序）。 */
  ids: readonly string[]
}

/**
 * 把一份图元载荷追加到一张图元表末尾（= 画在最上层）。
 * ⚠ 子树里每一层都要重发 id，不能只换顶层那一个：留着原 id 的子图元会让变体补丁
 * 同时命中原件与副本，改一处两处一起动。
 * ⚠ 深度上限**不在这里判**：能不能收下取决于落点在树里多深，只有拿着落点的调用方
 * 说得出（走 `primOps` 的 `twin2dPrimSpotBlock`）。本层再判一遍就是第二套口径，而两套
 * 对不上的表现是「粘上了，但少了最里面几层」——归一化在上限处截断，一声不吭。
 * @param input 目标表、载荷、已占用的 id 与 id 工厂
 */
export function pasteTwin2dPrims(
  input: Twin2dPrimPasteInput,
): Twin2dPrimsPasted {
  const makeId = input.makeId ?? newTwin2dId
  const taken = new Set(input.taken)
  const copies = input.clip.prims.map((prim) =>
    remintTwin2dPrim(prim, taken, makeId, RESEED_FRESH),
  )
  if (copies.length === 0) return { list: input.list, ids: [] }
  return {
    list: [...input.list, ...copies],
    ids: copies.map((prim) => prim.id),
  }
}

/** 实体载荷的脏数据防御：三类实例全空即当没有。 */
function parseEntityClip(
  raw: Record<string, unknown>,
  stampMs: number,
): Twin2dEntityClip | null {
  const nodes = normalizeNodes(raw.nodes)
  const edgeNodeIds = stringList(raw.edgeNodeIds)
  const edges = normalizeEdges(
    raw.edges,
    new Set([...nodes.map((node) => node.id), ...edgeNodeIds]),
  )
  const marks = normalizeMarks(raw.marks)
  if (nodes.length + edges.length + marks.length === 0) return null
  return {
    kind: 'entities',
    version: TWIN_2D_CLIPBOARD_VERSION,
    stampMs,
    nodes,
    edges,
    marks,
    edgeNodeIds,
    styles: normalizeNodeStyles(raw.styles),
    edgeStyles: normalizeEdgeStyles(raw.edgeStyles),
  }
}

/**
 * 读一份载荷。版本不符、坏形、或归一化之后空了，一律当没有。
 * ⚠ 全程走归一化而不是自己认字段：另写一套判据的那一份一旦与归一化漂开，粘出来的
 * 东西在存一次读回来之后会悄悄变样。
 * @param raw JSON.parse 出来的原始值
 */
export function parseTwin2dClip(raw: unknown): Twin2dClip | null {
  if (!isRecord(raw)) return null
  if (raw.version !== TWIN_2D_CLIPBOARD_VERSION) return null
  const stampMs = raw.stampMs
  if (typeof stampMs !== 'number' || !Number.isFinite(stampMs)) return null
  if (raw.kind === 'entities') return parseEntityClip(raw, stampMs)
  if (raw.kind !== 'prims') return null
  const prims = normalizePrims(raw.prims, 0)
  if (prims.length === 0) return null
  return { kind: 'prims', version: TWIN_2D_CLIPBOARD_VERSION, stampMs, prims }
}

/**
 * 剪贴板的两个通道。
 * ⚠ 没有「清空」这一支：内存里那份清掉并不能让 localStorage 里那份跟着没，下一次
 * `read` 又会把它捡回来——一个「清了却没清干净」的入口比没有这个入口更糟。
 */
export interface Twin2dClipboard {
  /** 写剪贴板；localStorage 是尽力而为，禁用时内存通道仍在。 */
  write: (clip: Twin2dClip) => void
  /**
   * 读剪贴板：两个通道里按复制时刻取新的那份。
   * ⚠ 不许内存优先——另一个标签页后来复制的那份更新，内存优先会让这个标签页永远
   * 粘出上一份内容，而且没有任何报错。
   */
  read: () => Twin2dClip | null
  /**
   * 下一次粘贴的位移：逐次累加一格，换上新的一份时归零。
   * @param stepPx 一格多少设计像素，缺省是缺省栅格
   */
  nextOffset: (stepPx?: number) => Pt
}

/** 剪贴板的现场；两个通道加一个粘贴计数。 */
interface ClipboardState {
  memory: Twin2dClip | null
  seq: number
  key: string
}

/** 换上新的一份并把粘贴位移归零：刚复制的东西该从第一格偏移贴起。 */
function adopt(state: ClipboardState, clip: Twin2dClip): void {
  state.memory = clip
  state.seq = 0
}

/** localStorage 里的那份；取不到、坏形或版本不符一律当没有。 */
function stored(key: string): Twin2dClip | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    return parseTwin2dClip(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * 造一份剪贴板。
 * ⚠ 状态收在闭包里而不是模块级：模块级的那一份在测试之间互相污染，且同一个页面开
 * 两个编辑器实例时会互相踩。
 * @param key localStorage 上的键
 */
export function createTwin2dClipboard(
  key: string = TWIN_2D_CLIPBOARD_KEY,
): Twin2dClipboard {
  const state: ClipboardState = { memory: null, seq: 0, key }
  return {
    write: (clip) => {
      adopt(state, clip)
      try {
        localStorage.setItem(state.key, JSON.stringify(clip))
      } catch {
        /* 无痕窗口或配额满：丢掉跨图通道，不该把复制整个弄失败 */
      }
    },
    read: () => {
      const outside = stored(state.key)
      const held = state.memory
      if (
        outside !== null &&
        (held === null || outside.stampMs > held.stampMs)
      ) {
        adopt(state, outside)
      }
      return state.memory
    },
    nextOffset: (stepPx = TWIN_2D_DEFAULT_GRID) => {
      state.seq += 1
      return { x: state.seq * stepPx, y: state.seq * stepPx }
    },
  }
}
