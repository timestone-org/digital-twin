/**
 * @fileoverview 图元树的纯变更：样式里那棵树的增删改、同级层序与跨级搬家，
 * 外加节点这一层的追加图元（`layers`）与按图元 id 的覆盖补丁（`patch`）。
 * 写样式一律经 `styleOps` 的 `writeNodeStyle`，「改内置样式 = 落一份同 id 的覆盖」
 * 这条判断因此只有一处（§13.4）。
 *
 * ⚠ 一律纯函数：收一份 `Twin2dConfig` 出一份新的；点名的东西不在就**原样返回入参
 *   那个引用**（`twin2dDoc.commit` 按引用判要不要压一帧撤销）。
 * ⚠ 图元 id 在一个样式里唯一——它是节点级覆盖、变体补丁与 `v-for` 三处的寻址键。
 *   复制一棵子树时**每一枚**后代都要重新发号：只换根那一枚的话，同 id 的两枚会被
 *   归一化按「同层去重」丢掉一枚，而画面上只是「粘出来的那份少了几笔」。
 * ⚠ 深度上限 6（`TWIN_2D_MAX_PRIM_DEPTH`）：归一化到了上限一律**归空数组**，
 *   所以拖太深的表现是「保存之后子树没了」。这里在动手之前就拦（`twin2dPrimMoveBlock`），
 *   让编辑器给得出提示。
 */
import { TWIN_2D_MAX_PRIM_DEPTH, normalizePrims } from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dPrim,
  Twin2dPrimKind,
  Twin2dPrimPatch,
} from '@dt/twin2d'

import { freshTwin2dId, newTwin2dId, orderList } from './nodeOps'
import type { Twin2dAdded, Twin2dIdFactory, Twin2dOrderMove } from './nodeOps'
import { writeNodeStyle } from './styleOps'

/** 新建图元的 id 前缀。 */
export const TWIN_2D_PRIM_ID_PREFIX = 'prim'

/** 一次搬家能被挡住的四档；`none` = 放行。 */
export const TWIN_2D_PRIM_MOVE_BLOCKS = [
  'none',
  'missing',
  'cycle',
  'depth',
] as const

/** 一次搬家能被挡住的四档。 */
export type Twin2dPrimMoveBlock = (typeof TWIN_2D_PRIM_MOVE_BLOCKS)[number]

/**
 * 四档各自给人看的说法。
 * ⚠ 摆在这里而不是各个面板里各写一句：拦得住却说不清为什么，与没拦住一样难查。
 */
export const TWIN_2D_PRIM_MOVE_BLOCK_LABELS: Readonly<
  Record<Twin2dPrimMoveBlock, string>
> = {
  none: '',
  missing: '这枚图元或落点已经不在了',
  cycle: '不能把一枚图元拖进它自己的子树里',
  depth: `图元最多嵌 ${TWIN_2D_MAX_PRIM_DEPTH} 层，再深会在保存时被截断`,
}

/**
 * 图元树上的一个落点。
 * ⚠ `index` 按**动之前**那张表数：同级往后拖时不必自己减一，`movePrim` 会替你减。
 */
export interface Twin2dPrimSpot {
  /** 落在哪个 `box` 里；null = 根层。 */
  parentId: string | null
  /** 落在这一层的第几个之前；越界或负数一律落到末尾。 */
  index: number
}

/** 一枚图元在树上的位置。 */
export interface Twin2dPrimAt {
  prim: Twin2dPrim
  parentId: string | null
  /** 根层是 0。 */
  depth: number
  /** 在自己这一层里的下标。 */
  index: number
}

/**
 * 新图元的种子：至少给 `kind`，其余交给归一化补缺省。
 * ⚠ 摊成一张自由记录而不是四种图元的 `Partial` 联合：联合的 `Partial` 会让
 * 「给了 `kind: 'txt'` 却填 box 的字段」在编译期照样过，反倒更松；真正的守门人是
 * `normalizePrim`，它按 `kind` 只收那一族的字段。
 */
export type Twin2dPrimSeed = { kind: Twin2dPrimKind } & Readonly<
  Record<string, unknown>
>

/**
 * 深度优先找一枚图元。
 * @param prims 这一层的图元表
 * @param id 要找的图元 id
 * @param parentId 这一层挂在谁下面
 * @param depth 这一层的层深
 */
function locate(
  prims: readonly Twin2dPrim[],
  id: string,
  parentId: string | null,
  depth: number,
): Twin2dPrimAt | null {
  let index = 0
  for (const prim of prims) {
    if (prim.id === id) return { prim, parentId, depth, index }
    if (prim.kind === 'box') {
      const inside = locate(prim.children, id, prim.id, depth + 1)
      if (inside !== null) return inside
    }
    index += 1
  }
  return null
}

/**
 * 深度优先找一枚图元，连它的位置一起交出来。
 * @param prims 整棵图元树
 * @param id 要找的图元 id
 */
export function findTwin2dPrim(
  prims: readonly Twin2dPrim[],
  id: string,
): Twin2dPrimAt | null {
  return locate(prims, id, null, 0)
}

/**
 * 一棵子树有多高：叶子是 0，只有一层子的是 1。
 * @param prim 子树的根
 */
export function twin2dPrimHeight(prim: Twin2dPrim): number {
  if (prim.kind !== 'box') return 0
  return prim.children.reduce(
    (deepest, child) => Math.max(deepest, twin2dPrimHeight(child) + 1),
    0,
  )
}

/**
 * 换掉某一层的整张表，其余枝原样带回。
 * ⚠ 没被改到的那些枝连**引用**都不换（`applyVariants` 的 `patchedTree` 是同一条
 * 口径）：整树重建会让每一枚子图元的 props 每帧都换一遍，hover 一个节点就重绘整张图。
 * @param prims 这一层的图元表
 * @param parentId 要换的是谁的孩子；null = 根层
 * @param edit 拿旧表出新表
 */
function withList(
  prims: readonly Twin2dPrim[],
  parentId: string | null,
  edit: (list: readonly Twin2dPrim[]) => readonly Twin2dPrim[],
): readonly Twin2dPrim[] {
  if (parentId === null) return edit(prims)
  let changed = false
  const next = prims.map((prim) => {
    if (prim.kind !== 'box') return prim
    const children =
      prim.id === parentId
        ? edit(prim.children)
        : withList(prim.children, parentId, edit)
    if (children === prim.children) return prim
    changed = true
    return { ...prim, children }
  })
  return changed ? next : prims
}

/** 插进一张表；下标越界一律落到末尾。 */
function insertAt(
  list: readonly Twin2dPrim[],
  index: number,
  items: readonly Twin2dPrim[],
): readonly Twin2dPrim[] {
  const bounded = index < 0 || index > list.length ? list.length : index
  return [...list.slice(0, bounded), ...items, ...list.slice(bounded)]
}

/** 从树上摘掉一枚图元（连它的子树）；不在就原样返回入参那个引用。 */
function dropPrim(
  prims: readonly Twin2dPrim[],
  id: string,
): readonly Twin2dPrim[] {
  const at = findTwin2dPrim(prims, id)
  if (at === null) return prims
  return withList(prims, at.parentId, (list) =>
    list.filter((prim) => prim.id !== id),
  )
}

/** 一棵子树上的全部 id。 */
function collectIds(prims: readonly Twin2dPrim[], into: Set<string>): void {
  for (const prim of prims) {
    into.add(prim.id)
    if (prim.kind === 'box') collectIds(prim.children, into)
  }
}

/**
 * 一棵图元树上所有的 id（含各层子树）。
 * ⚠ 只收同级会重名：图元 id 在**整份样式**里唯一，节点级覆盖与变体补丁都按它寻址。
 * @param prims 图元表
 */
export function twin2dPrimIds(prims: readonly Twin2dPrim[]): Set<string> {
  const found = new Set<string>()
  collectIds(prims, found)
  return found
}

/** 重新发号时，这一枚的新 id 从哪个前缀起。 */
export type Twin2dPrimReseed = (prim: Twin2dPrim) => string

/**
 * 复制一棵子树并逐枚重新发号；`taken` 就地记账。
 * ⚠ 再制与粘贴共用这一份。各写一份的话，「子树里**每一枚**都要重发号」这条会在其中
 * 一处漏掉，而漏掉的那份要等到归一化按同层去重丢掉一枚、且节点级覆盖跟着原件一起
 * 变时才看得出来——三处都零报错。
 * @param prim 子树的根
 * @param taken 已经占用的 id，边发边记
 * @param makeId id 工厂
 * @param reseed 新 id 从哪个前缀起
 */
export function remintTwin2dPrim(
  prim: Twin2dPrim,
  taken: Set<string>,
  makeId: Twin2dIdFactory,
  reseed: Twin2dPrimReseed,
): Twin2dPrim {
  const id = freshTwin2dId(reseed(prim), taken, makeId)
  taken.add(id)
  if (prim.kind !== 'box') return { ...prim, id }
  return {
    ...prim,
    id,
    children: prim.children.map((child) =>
      remintTwin2dPrim(child, taken, makeId, reseed),
    ),
  }
}

/** 再制：新 id 从原 id 起，一眼看得出它是谁的副本。 */
const RESEED_FROM_SELF: Twin2dPrimReseed = (prim) => prim.id

/**
 * 一个落点收不收得下一棵高 `height` 的子树。
 * ⚠ 深度是从**根层 0** 数的：一枚落在深度 d 的图元，它的子树占 d..d+height，
 * 而归一化只留 `depth < 6` 的那几层——超了的那部分是被**丢掉**不是被压平。
 * @param style 当下生效的那一份样式
 * @param spot 落点
 * @param height 要放进去的子树有多高（叶子给 0）
 */
export function twin2dPrimSpotBlock(
  style: Twin2dNodeStyle,
  spot: Twin2dPrimSpot,
  height: number,
): Twin2dPrimMoveBlock {
  if (spot.parentId === null) {
    return height < TWIN_2D_MAX_PRIM_DEPTH ? 'none' : 'depth'
  }
  const parent = findTwin2dPrim(style.prims, spot.parentId)
  if (parent === null || parent.prim.kind !== 'box') return 'missing'
  const landing = parent.depth + 1
  return landing + height < TWIN_2D_MAX_PRIM_DEPTH ? 'none' : 'depth'
}

/**
 * 把一枚图元搬到这个落点，拦不拦得住。
 * ⚠ 拖进自己的子树里要单独拦一档：先摘再插的实现会让整棵子树连同落点一起消失，
 * 而那既不报错也不像误操作——图上就是少了一块。
 * @param style 当下生效的那一份样式
 * @param primId 要搬的图元
 * @param spot 落点
 */
export function twin2dPrimMoveBlock(
  style: Twin2dNodeStyle,
  primId: string,
  spot: Twin2dPrimSpot,
): Twin2dPrimMoveBlock {
  const at = findTwin2dPrim(style.prims, primId)
  if (at === null) return 'missing'
  if (spot.parentId !== null) {
    const inside = new Set<string>()
    collectIds([at.prim], inside)
    if (inside.has(spot.parentId)) return 'cycle'
  }
  return twin2dPrimSpotBlock(style, spot, twin2dPrimHeight(at.prim))
}

/** 换一棵图元树写回样式。 */
function writePrims(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  prims: readonly Twin2dPrim[],
): Twin2dConfig {
  return writeNodeStyle(config, { ...style, prims })
}

/**
 * 往样式的图元树上加一枚图元。
 * ⚠ 种子只给要紧的几项，其余交给归一化补缺省：在这里抄一份缺省值，抄的那份一旦与
 * 归一化不一致，新图元会在「存一次再读回来」之后悄悄变样。
 * ⚠ 落点收不下（父不在、或连同种子自带的子树一起超过 6 层）时交出的是**原样的配置**
 * 与 `id: null`，而不是一枚被截断过的图元——截断在画面上只是「少了几笔」。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param spot 落点
 * @param seed 新图元的种子（至少给 `kind`）
 * @param makeId id 工厂，缺省随机
 */
export function addPrim(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  spot: Twin2dPrimSpot,
  seed: Twin2dPrimSeed,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const taken = new Set<string>()
  collectIds(style.prims, taken)
  const id = freshTwin2dId(TWIN_2D_PRIM_ID_PREFIX, taken, makeId)
  // ⚠ 先按根层归一化再量高：归一化在上限处截断，量一棵已经被截过的树等于自己骗自己。
  //   `kind` 在类型上就是四档之一、id 又是现造的，所以这一枚必落地，不必再判空
  const fresh = normalizePrims([{ ...seed, id }], 0)
  const height = fresh.reduce(
    (tallest, prim) => Math.max(tallest, twin2dPrimHeight(prim)),
    0,
  )
  if (twin2dPrimSpotBlock(style, spot, height) !== 'none') {
    return { config, id: null }
  }
  const prims = withList(style.prims, spot.parentId, (list) =>
    insertAt(list, spot.index, fresh),
  )
  return { config: writePrims(config, style, prims), id }
}

/**
 * 复制一枚图元（连它的子树），副本插在原件后面。
 * ⚠ 子树里**每一枚**都重新发号：只换根那一枚的话，同 id 的两枚会被归一化按同层去重
 * 丢掉一枚，而节点级覆盖与变体补丁又都按 id 寻址，于是「粘出来的那份」会跟着原件
 * 一起变——三处都零报错。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param primId 要复制的图元
 * @param makeId id 工厂，缺省随机
 */
export function duplicatePrim(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  primId: string,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const at = findTwin2dPrim(style.prims, primId)
  if (at === null) return { config, id: null }
  const taken = new Set<string>()
  collectIds(style.prims, taken)
  const copy = remintTwin2dPrim(at.prim, taken, makeId, RESEED_FROM_SELF)
  const prims = withList(style.prims, at.parentId, (list) =>
    insertAt(list, at.index + 1, [copy]),
  )
  return { config: writePrims(config, style, prims), id: copy.id }
}

/**
 * 换掉样式图元树上的一枚图元，按 `next.id` 寻址；图元不在就原样返回入参那份配置。
 * ⚠ 收整枚而不是一份补丁：图元是判别联合，只有拿着当下这一枚的调用方才知道该往
 * 哪一族里填字段；在这里做联合的浅合并等于把 `Twin2dPrimPatch` 那套「哪些键归哪一族」
 * 再抄一遍，而抄的那份一旦与变体求值漂开，同一条补丁在编辑器与画面上就是两个样子。
 * ⚠ 改 id 得走「删 + 加」：节点级覆盖与变体补丁都按 id 寻址，顺手换掉 id 会让两处
 * 一起指空——这里按 `next.id` 寻址，所以换过 id 的那一枚只会被当成「不在」。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param next 整枚新图元
 */
export function updatePrim(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  next: Twin2dPrim,
): Twin2dConfig {
  const at = findTwin2dPrim(style.prims, next.id)
  if (at === null) return config
  const prims = withList(style.prims, at.parentId, (list) =>
    list.map((prim) => (prim.id === next.id ? next : prim)),
  )
  return writePrims(config, style, prims)
}

/**
 * 从样式的图元树上删掉一枚图元，连它的子树。
 * ⚠ 指着它的变体补丁与节点级覆盖**不跟着删**：那两处各有一条诊断
 * （`dangling-variant-prim` / `dangling-prim`），而在这里替用户清掉，一份被二十个
 * 节点共用的样式会因为样式面上的一次点击就改到二十个节点实例上去。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param primId 要删的图元
 */
export function removePrim(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  primId: string,
): Twin2dConfig {
  const prims = dropPrim(style.prims, primId)
  if (prims === style.prims) return config
  return writePrims(config, style, prims)
}

/**
 * 调一枚图元在**同一层**里的次序。
 * ⚠ 文档序是 DOM 序，而图元自己的 `z` 落成 CSS `z-index`：两者不一致时看到的是
 * `z` 说了算，所以「上移一层没反应」通常是有人给这一枝配了 `z`。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param primId 要动的图元
 * @param move 四档层序
 */
export function orderPrims(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  primId: string,
  move: Twin2dOrderMove,
): Twin2dConfig {
  const at = findTwin2dPrim(style.prims, primId)
  if (at === null) return config
  let moved = false
  const prims = withList(style.prims, at.parentId, (list) => {
    const ordered = orderList(list, [primId], move)
    moved = ordered !== list
    return ordered
  })
  return moved ? writePrims(config, style, prims) : config
}

/**
 * 跨级搬家：把一枚图元（连它的子树）挪到另一个落点。
 * ⚠ 拦得住的三档一律**原样返回入参那份配置**，别的什么都不做：让「超深」这一步
 * 走到归一化那里，用户看到的是保存之后子树没了。调用方要先问
 * `twin2dPrimMoveBlock` 拿到那一档的说法（`TWIN_2D_PRIM_MOVE_BLOCK_LABELS`）。
 * @param config 当前配置
 * @param style 当下生效的那一份样式
 * @param primId 要搬的图元
 * @param spot 落点，`index` 按动之前那张表数
 */
export function movePrim(
  config: Twin2dConfig,
  style: Twin2dNodeStyle,
  primId: string,
  spot: Twin2dPrimSpot,
): Twin2dConfig {
  const at = findTwin2dPrim(style.prims, primId)
  if (at === null) return config
  if (twin2dPrimMoveBlock(style, primId, spot) !== 'none') return config
  // ⚠ 拖起来又放回原处（同级、落点就是它自己或紧跟其后）是最常见的一种手势：
  //   不在这里认出来的话，撤销栈上会多一格按了没反应的空步
  const backHome =
    spot.parentId === at.parentId &&
    (spot.index === at.index || spot.index === at.index + 1)
  if (backHome) return config
  // 同级往后挪：抽走它自己之后，落点跟着前移一格
  const index =
    spot.parentId === at.parentId && spot.index > at.index
      ? spot.index - 1
      : spot.index
  const without = dropPrim(style.prims, primId)
  const prims = withList(without, spot.parentId, (list) =>
    insertAt(list, index, [at.prim]),
  )
  return writePrims(config, style, prims)
}

/** 把一个改过的节点写回。 */
function writeNode(config: Twin2dConfig, node: Twin2dNode): Twin2dConfig {
  return {
    ...config,
    nodes: config.nodes.map((row) => (row.id === node.id ? node : row)),
  }
}

/**
 * 换一个节点上的字段，节点不在（或这一手什么都不必改）就原样返回入参那份配置。
 * @param config 当前配置
 * @param nodeId 节点 id
 * @param edit 拿旧节点出新节点；回 null 表示这一手不必改
 */
function withNode(
  config: Twin2dConfig,
  nodeId: string,
  edit: (node: Twin2dNode) => Twin2dNode | null,
): Twin2dConfig {
  const target = config.nodes.find((node) => node.id === nodeId)
  if (target === undefined) return config
  const next = edit(target)
  return next === null ? config : writeNode(config, next)
}

/**
 * 给一个节点加一枚追加图元（`layers`），追加在末尾。
 * ⚠ 新 id 要同时避开**样式里**那棵树：两边是并起来渲染的（`[...style.prims,
 * ...node.layers]`），撞了 id 会让节点级覆盖与变体补丁同时打在两枚图元上。
 * 样式悬空时传 null——那种节点整个不画，重不重名都无所谓。
 * @param config 当前配置
 * @param nodeId 节点 id
 * @param style 这个节点用的样式；解析不到给 null
 * @param seed 新图元的种子（至少给 `kind`）
 * @param makeId id 工厂，缺省随机
 */
export function addNodeLayer(
  config: Twin2dConfig,
  nodeId: string,
  style: Twin2dNodeStyle | null,
  seed: Twin2dPrimSeed,
  makeId: Twin2dIdFactory = newTwin2dId,
): Twin2dAdded {
  const node = config.nodes.find((row) => row.id === nodeId)
  if (node === undefined) return { config, id: null }
  const taken = new Set<string>()
  collectIds(node.layers, taken)
  if (style !== null) collectIds(style.prims, taken)
  const id = freshTwin2dId(TWIN_2D_PRIM_ID_PREFIX, taken, makeId)
  const layers = [...node.layers, ...normalizePrims([{ ...seed, id }], 0)]
  return { config: writeNode(config, { ...node, layers }), id }
}

/**
 * 换掉一个节点上的一枚追加图元，按 `next.id` 寻址。
 * @param config 当前配置
 * @param nodeId 节点 id
 * @param next 整枚新图元
 */
export function updateNodeLayer(
  config: Twin2dConfig,
  nodeId: string,
  next: Twin2dPrim,
): Twin2dConfig {
  return withNode(config, nodeId, (node) => {
    const at = findTwin2dPrim(node.layers, next.id)
    if (at === null) return null
    return {
      ...node,
      layers: withList(node.layers, at.parentId, (list) =>
        list.map((prim) => (prim.id === next.id ? next : prim)),
      ),
    }
  })
}

/**
 * 删掉一个节点上的一枚追加图元，连它的子树。
 * @param config 当前配置
 * @param nodeId 节点 id
 * @param primId 要删的图元
 */
export function removeNodeLayer(
  config: Twin2dConfig,
  nodeId: string,
  primId: string,
): Twin2dConfig {
  return withNode(config, nodeId, (node) => {
    const layers = dropPrim(node.layers, primId)
    return layers === node.layers ? null : { ...node, layers }
  })
}

/**
 * 写一条节点级覆盖补丁（`patch[primId]`），整条换掉。
 * ⚠ 浅覆盖里「不覆盖」与「覆盖成缺省值」是两回事：清掉一格要把那个**键整个去掉**
 * 再写回来，写一个缺省值进去会把样式改过的那一格一起按回缺省。
 * @param config 当前配置
 * @param nodeId 节点 id
 * @param primId 被覆盖的图元 id
 * @param patch 这一条覆盖的新内容
 */
export function setNodePrimPatch(
  config: Twin2dConfig,
  nodeId: string,
  primId: string,
  patch: Twin2dPrimPatch,
): Twin2dConfig {
  return withNode(config, nodeId, (node) => ({
    ...node,
    patch: { ...node.patch, [primId]: patch },
  }))
}

/**
 * 撤掉整条节点级覆盖补丁。
 * @param config 当前配置
 * @param nodeId 节点 id
 * @param primId 被覆盖的图元 id
 */
export function clearNodePrimPatch(
  config: Twin2dConfig,
  nodeId: string,
  primId: string,
): Twin2dConfig {
  return withNode(config, nodeId, (node) => {
    if (node.patch[primId] === undefined) return null
    const kept = Object.entries(node.patch).filter(([key]) => key !== primId)
    return { ...node, patch: Object.fromEntries(kept) }
  })
}
