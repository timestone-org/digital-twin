/**
 * @fileoverview 「归一化整条丢掉了什么」的那一族诊断，全部跑在**原始** JSON 上：
 * 被丢的节点 / 连线 / 标注 / 图元 / 槽位 / 端口 / 变体、被截断的超深图元层，以及退成
 * 空档的 sprite。这些东西在归一化输出里已经不在了，只有原始文档还看得见它们。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.2、§4.6、§9.5。
 */
import { TWIN_2D_MAX_PRIM_DEPTH } from './constants'
import {
  TWIN_2D_MARK_KINDS,
  TWIN_2D_PRIM_KINDS,
  TWIN_2D_SPRITE_IDS,
} from './kinds'
import { normalizeEdge, normalizeEndpoint } from './normalizeEdges'
import { normalizeMark } from './normalizeMarks'
import { normalizeNode } from './normalizeNodes'
import { normalizePrim } from './normalizePrims'
import {
  normalizeNodeStyle,
  normalizePort,
  normalizeSlot,
  normalizeVariant,
} from './normalizeStyles'
import { idOf, isRecord, oneOf, toArray } from './sanitize'
import type { Twin2dIssue, Twin2dIssueCode } from './issueTypes'
import type { Twin2dConfig } from './types'

/** 超深那一层的说法 */
const TOO_DEEP_MESSAGE = `图元树深度超过上限 ${TWIN_2D_MAX_PRIM_DEPTH}，这一层连同它的子树会被截断丢掉`

/** 原始表里被丢掉的一行：字段路径、原始条目，以及重的是哪个键（不重就是 null）。 */
interface Twin2dDropRow {
  at: string
  raw: unknown
  duplicateOf: string | null
}

/** 原始表里活下来的一行：字段路径与原始记录。 */
interface Twin2dKeptRow {
  at: string
  raw: Record<string, unknown>
}

/** 一张原始表扫下来的两半。 */
interface Twin2dTableRows {
  kept: Twin2dKeptRow[]
  dropped: Twin2dDropRow[]
}

/** 一张表的丢弃措辞：落哪个 code，「产不出」与「重键」各怎么说。 */
interface Twin2dDropWords {
  code: Twin2dIssueCode
  missing: (raw: unknown) => string
  duplicate: (key: string) => string
}

/**
 * 一条丢弃诊断，一律 `error`：配好的东西整条不见了，而渲染层对此零报错。
 * @param code 问题种类
 * @param at 原始文档里的字段路径
 * @param message 一句话说清丢的是什么、为什么丢
 */
function droppedIssue(
  code: Twin2dIssueCode,
  at: string,
  message: string,
): Twin2dIssue {
  return { level: 'error', code, message, at }
}

/**
 * 原始条目上的一个 id 字段；不是对象或没写这个字段都回空串。
 * @param raw 原始条目
 * @param key 字段名
 */
function rawIdOf(raw: unknown, key: string): string {
  return isRecord(raw) ? idOf(raw[key]) : ''
}

/**
 * 扫一张「按键去重」的原始表：逐条跑单条归一函数，产不出的与重键的进 `dropped`，
 * 其余进 `kept`。
 * ⚠ 丢不丢一律由归一函数说了算，这里只额外记一个「已见过的键」——另写一套判据
 * 就是第二份真源，两份必漂。
 * @param raw 原始数组
 * @param at 这张表在文档里的字段路径
 * @param one 单条归一函数
 * @param keyOf 取一条的身份键
 */
function scanTable<T>(
  raw: unknown,
  at: string,
  one: (item: unknown) => T | null,
  keyOf: (item: T) => string,
): Twin2dTableRows {
  const rows: Twin2dTableRows = { kept: [], dropped: [] }
  const seen = new Set<string>()
  toArray(raw).forEach((item, index) => {
    const here = `${at}[${index}]`
    if (!isRecord(item)) {
      rows.dropped.push({ at: here, raw: item, duplicateOf: null })
      return
    }
    const kept = one(item)
    if (kept === null) {
      rows.dropped.push({ at: here, raw: item, duplicateOf: null })
      return
    }
    const key = keyOf(kept)
    if (seen.has(key)) {
      rows.dropped.push({ at: here, raw: item, duplicateOf: key })
      return
    }
    seen.add(key)
    rows.kept.push({ at: here, raw: item })
  })
  return rows
}

/**
 * 一张表里被丢掉的那些行翻成诊断。
 * @param rows 扫表的结果
 * @param words 这张表的丢弃措辞
 */
function tableDrops(
  rows: Twin2dTableRows,
  words: Twin2dDropWords,
): Twin2dIssue[] {
  return rows.dropped.map((row) =>
    droppedIssue(
      words.code,
      row.at,
      row.duplicateOf === null
        ? words.missing(row.raw)
        : words.duplicate(row.duplicateOf),
    ),
  )
}

const NODE_WORDS: Twin2dDropWords = {
  code: 'dropped-node',
  missing: () => '这个节点没有可用的 id，整条会被丢掉',
  duplicate: (key) => `节点 id ${key} 与前面某个节点重复，后来的这条会被丢掉`,
}

const MARK_WORDS: Twin2dDropWords = {
  code: 'dropped-mark',
  missing: (raw) =>
    rawIdOf(raw, 'id') === ''
      ? '这条标注没有可用的 id，整条会被丢掉'
      : `这条标注的 kind 不在 ${TWIN_2D_MARK_KINDS.join(' / ')} 三档内，整条会被丢掉`,
  duplicate: (key) => `标注 id ${key} 与前面某条标注重复，后来的这条会被丢掉`,
}

const SLOT_WORDS: Twin2dDropWords = {
  code: 'dropped-slot',
  missing: () => '这个槽位没有可用的 key，整条会被丢掉',
  duplicate: (key) => `槽位 key ${key} 与前面某个槽位重复，后来的这条会被丢掉`,
}

const PORT_WORDS: Twin2dDropWords = {
  code: 'dropped-port',
  missing: () => '这个端口没有可用的 id，整条会被丢掉',
  duplicate: (key) => `端口 id ${key} 与前面某个端口重复，后来的这条会被丢掉`,
}

const VARIANT_WORDS: Twin2dDropWords = {
  code: 'dropped-variant',
  missing: (raw) =>
    rawIdOf(raw, 'id') === ''
      ? '这条变体没有可用的 id，整条会被丢掉'
      : '这条变体的触发条件不合法，整条会被丢掉',
  duplicate: (key) => `变体 id ${key} 与前面某条变体重复，后来的这条会被丢掉`,
}

const PRIM_WORDS: Twin2dDropWords = {
  code: 'dropped-prim',
  missing: (raw) =>
    rawIdOf(raw, 'id') === ''
      ? '这个图元没有可用的 id，它连同子树会被丢掉'
      : `这个图元的 kind 不在 ${TWIN_2D_PRIM_KINDS.join(' / ')} 四档内，它连同子树会被丢掉`,
  duplicate: (key) => `图元 id ${key} 与同层前面的重复，后来的这一枝会被丢掉`,
}

/**
 * 一个端点留不下来的原因；端点没问题时返回 null。
 * @param raw 原始端点
 * @param nodeIds 归一化后仍然存在的节点 id 集合
 * @param label 这是哪一端
 */
function endpointDropReason(
  raw: unknown,
  nodeIds: ReadonlySet<string>,
  label: string,
): string | null {
  if (normalizeEndpoint(raw, nodeIds) !== null) return null
  const nodeId = rawIdOf(raw, 'nodeId')
  return nodeId === ''
    ? `${label}没有指向任何节点`
    : `${label}指向的节点 ${nodeId} 不在文档里`
}

/**
 * 一条连线被丢的原因。只在 `normalizeEdge` 已经判定丢弃之后问它。
 * ⚠ 先问两端再问 id：两端里任意一端悬空都足以丢掉整条，而那才是用户想知道的
 * 「哪个节点没了」；id 缺失是最后才轮到的那种。
 * @param raw 原始连线
 * @param nodeIds 归一化后仍然存在的节点 id 集合
 */
function edgeDropReason(raw: unknown, nodeIds: ReadonlySet<string>): string {
  if (!isRecord(raw)) return '这一条不是一个对象'
  const from = endpointDropReason(raw.from, nodeIds, '起点')
  if (from !== null) return from
  const to = endpointDropReason(raw.to, nodeIds, '终点')
  if (to !== null) return to
  return '这条连线没有可用的 id'
}

/**
 * 连线的丢弃措辞；要拿节点 id 集合才说得出「哪个节点查不到」。
 * @param nodeIds 归一化后仍然存在的节点 id 集合
 */
function edgeWords(nodeIds: ReadonlySet<string>): Twin2dDropWords {
  return {
    code: 'dropped-edge',
    missing: (raw) => `${edgeDropReason(raw, nodeIds)}，整条连线会被丢掉`,
    duplicate: (key) => `连线 id ${key} 与前面某条连线重复，后来的这条会被丢掉`,
  }
}

/**
 * `ico` 指到一枚内置图标集里没有的 sprite。
 * ⚠ 归一化把它退成 `{kind:'none'}`，图标整个消失且零报错，所以这一条只有拿原始
 * 图元才查得到（§5）。
 * @param raw 原始图元
 * @param at 这个图元在原始文档里的字段路径
 */
function spriteIssues(raw: Record<string, unknown>, at: string): Twin2dIssue[] {
  const src = raw.src
  if (raw.kind !== 'ico' || !isRecord(src) || src.kind !== 'sprite') return []
  if (oneOf<string>(src.id, TWIN_2D_SPRITE_IDS, '') !== '') return []
  const id = idOf(src.id)
  return [
    {
      level: 'error',
      code: 'dangling-sprite',
      message:
        id === ''
          ? '这枚图标没写 sprite id，图标会整个消失'
          : `内置图标集里没有 ${id}，这个图标会整个消失`,
      at: `${at}.src.id`,
    },
  ]
}

/**
 * 一层原始图元：超过深度上限的整层只报截断，其余逐条查丢弃、sprite 与子树。
 * ⚠ 超深那一层报完就不再往下走——一棵一千层的树否则会刷出九百多条。
 * @param raw 原始图元数组
 * @param at 这一层在原始文档里的字段路径
 * @param depth 这一层的层深，最外层是 1
 */
function primLayerIssues(
  raw: unknown,
  at: string,
  depth: number,
): Twin2dIssue[] {
  if (depth > TWIN_2D_MAX_PRIM_DEPTH) {
    return toArray(raw).map((_, index) =>
      droppedIssue('prim-too-deep', `${at}[${index}]`, TOO_DEEP_MESSAGE),
    )
  }
  const rows = scanTable(
    raw,
    at,
    (item) => normalizePrim(item, depth - 1),
    (prim) => prim.id,
  )
  return [
    ...tableDrops(rows, PRIM_WORDS),
    ...rows.kept.flatMap((row) => keptPrimIssues(row, depth)),
  ]
}

/**
 * 一个留得下来的图元自己还能出的问题：sprite 悬空与它的子树。
 * @param row 这个图元的原始记录与路径
 * @param depth 它所在的层深
 */
function keptPrimIssues(row: Twin2dKeptRow, depth: number): Twin2dIssue[] {
  return [
    ...spriteIssues(row.raw, row.at),
    ...(row.raw.kind === 'box'
      ? primLayerIssues(row.raw.children, `${row.at}.children`, depth + 1)
      : []),
  ]
}

/**
 * 样式与节点共用的两张小表：槽位与端口。
 * @param raw 样式或节点的原始记录
 * @param at 它在原始文档里的字段路径
 */
function slotAndPortDrops(
  raw: Record<string, unknown>,
  at: string,
): Twin2dIssue[] {
  return [
    ...tableDrops(
      scanTable(raw.slots, `${at}.slots`, normalizeSlot, (slot) => slot.key),
      SLOT_WORDS,
    ),
    ...tableDrops(
      scanTable(raw.ports, `${at}.ports`, normalizePort, (port) => port.id),
      PORT_WORDS,
    ),
  ]
}

/**
 * 一个留得下来的样式里还会被丢掉的东西：图元树、槽位、端口与变体。
 * @param row 这个样式的原始记录与路径
 */
function styleInnerIssues(row: Twin2dKeptRow): Twin2dIssue[] {
  return [
    ...primLayerIssues(row.raw.prims, `${row.at}.prims`, 1),
    ...slotAndPortDrops(row.raw, row.at),
    ...tableDrops(
      scanTable(
        row.raw.variants,
        `${row.at}.variants`,
        normalizeVariant,
        (variant) => variant.id,
      ),
      VARIANT_WORDS,
    ),
  ]
}

/**
 * 一个留得下来的节点里还会被丢掉的东西：追加的槽位、端口与图元层。
 * @param row 这个节点的原始记录与路径
 */
function nodeInnerIssues(row: Twin2dKeptRow): Twin2dIssue[] {
  return [
    ...slotAndPortDrops(row.raw, row.at),
    ...primLayerIssues(row.raw.layers, `${row.at}.layers`, 1),
  ]
}

/**
 * 收齐「归一化整条丢掉了什么」的全部诊断，`at` 一律是**原始**文档里的下标。
 * ⚠ 被丢掉的样式与节点不再往里扫：整块都不见了，再报它内部的槽位与图元只是噪声。
 * @param raw 原始文档
 * @param config 同一份文档的归一化结果，用来取仍然存在的节点 id
 */
export function collectTwin2dDroppedIssues(
  raw: unknown,
  config: Twin2dConfig,
): Twin2dIssue[] {
  const source = isRecord(raw) ? raw : {}
  const nodeIds = new Set(config.nodes.map((node) => node.id))
  const nodes = scanTable(
    source.nodes,
    'nodes',
    normalizeNode,
    (node) => node.id,
  )
  const styles = scanTable(
    source.styles,
    'styles',
    normalizeNodeStyle,
    (style) => style.id,
  )
  return [
    ...tableDrops(nodes, NODE_WORDS),
    ...tableDrops(
      scanTable(
        source.edges,
        'edges',
        (item) => normalizeEdge(item, nodeIds),
        (edge) => edge.id,
      ),
      edgeWords(nodeIds),
    ),
    ...tableDrops(
      scanTable(source.marks, 'marks', normalizeMark, (mark) => mark.id),
      MARK_WORDS,
    ),
    ...styles.kept.flatMap(styleInnerIssues),
    ...nodes.kept.flatMap(nodeInnerIssues),
  ]
}
