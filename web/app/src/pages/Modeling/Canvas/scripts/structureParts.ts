/**
 * @fileoverview 「模型内部长什么样」这一块的算料：六样各自可缺，各折成一张图要
 * 的形状，外加每张图下那行必须有的文字结论。
 *
 * ⚠ 逻辑放在这里而不是组件里：退化分支（一样都没有 / 只有一条轴 / 曲线只有一个
 * 点 / 载荷全零 / 代表树只有一个根）只有当纯函数才测得到。
 * ⚠ 载荷有正有负，零在中间：用顺序色阶会把 −0.62 与 +0.02 画成同一个深浅。这里
 * 出的是「方块面积 = 绝对值、负载荷画成空心」，颜色不作唯一编码（规格 §2-P6）。
 */
import type { BarListItem } from './barList'
import type { BlockNote } from './blockNotes'
import { notesOf, sortedNotes } from './blockNotes'
import { grouped, niceNumber, percentText } from './numbers'
import type { PdpCurve } from './reportBlocks'
import { recordOf, structureOf } from './reportBlocks'

type Item = Record<string, unknown>

/** 逐样的硬上限，与后端 `reporting.py` 逐字对齐。 */
export const MAX_IMPORTANCES = 60
export const MAX_RANGES = 60
export const MAX_TREE_NODES = 31
export const MAX_PDP = 10
export const MAX_LOADINGS = 20
export const MAX_LOADING_WIDTH = 20
export const MAX_EXPLAINED = 20

/** 累计解释方差过了这条线就够用了，碎石图上画一条（规格 §5-12）。 */
const ENOUGH = 0.8

/** 载荷格的画幅（SVG 用户坐标）。 */
const CELL = 16
const LABEL_WIDTH = 68
const HEAD_HEIGHT = 44
const PAD = 6
/** 行列名印到这么多字为止，全名挂在格子的 `<title>` 上。 */
const NAME_CHARS = 8

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function countOf(value: unknown): number {
  return numberOf(value) ?? 0
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textsOf(value: unknown): string[] {
  return listOf(value).map((one) => textOf(one))
}

function numbersOf(value: unknown): number[] {
  const kept: number[] = []
  for (const one of listOf(value)) {
    const found = numberOf(one)
    if (found !== null) kept.push(found)
  }
  return kept
}

/**
 * 顶到上限时的实话（规格 §2-P5）。
 *
 * ⚠ 只说得出「顶到了」说不出「一共多少」：后端截断时没有把原始条数留下来，
 * 硬编一个总数就是假数。
 * Args: count 拿到几项；limit 硬上限；what 这一串叫什么。
 */
export function capNote(count: number, limit: number, what: string): string {
  return count < limit
    ? ''
    : `${what}顶到了上限 ${limit} 项，后端可能还截掉了没列出来的那些`
}

/** 这一块上挂着的话，告警在前。 */
export function blockNotes(payload: Item): BlockNote[] {
  return sortedNotes(notesOf(payload))
}

/** 名字印到 `NAME_CHARS` 个字为止；全名另有出处，这里只管排得下。 */
function shortName(name: string): string {
  const glyphs = [...name]
  return glyphs.length <= NAME_CHARS
    ? name
    : `${glyphs.slice(0, NAME_CHARS).join('')}…`
}

/** 置换重要性 / 树重要性排行。⚠ 后端这一串的名字键是 `key` 不是 `name`。 */
export function importanceRows(payload: Item): BarListItem[] {
  return structureOf(payload).importances.map((item) => ({
    name: textOf(item['key']),
    value: numberOf(item['value']),
    tone: 'primary',
  }))
}

/** 每个特征在训练集上的取值区间。 */
export function rangeRows(payload: Item): BarListItem[] {
  return structureOf(payload).ranges.map((item) => ({
    name: textOf(item['key']),
    low: numberOf(item['low']),
    high: numberOf(item['high']),
    tone: 'neutral',
  }))
}

/** 重要性那一排的文字结论。 */
export function importanceSummary(rows: readonly BarListItem[]): string {
  const known = rows.filter(
    (row): row is BarListItem & { value: number } =>
      typeof row.value === 'number',
  )
  const [top] = [...known].sort((one, two) => two.value - one.value)
  if (top === undefined) return `共 ${rows.length} 列，没有一列算得出重要性`
  const total = known.reduce((sum, row) => sum + Math.abs(row.value), 0)
  const share =
    total > 0
      ? `，占全部重要性的 ${percentText((Math.abs(top.value) / total) * 100)}`
      : ''
  return `共 ${rows.length} 列，最重要的是「${top.name}」${niceNumber(top.value)}${share}`
}

/** 训练取值区间那一排的文字结论。⚠ 「不外推」这句必须在，它是树独有的坑。 */
export function rangeSummary(rows: readonly BarListItem[]): string {
  const [first] = rows
  if (first === undefined) return '这一步没有拿到每列的训练取值区间'
  const head = `${rows.length} 列各自的训练取值区间，例如「${first.name}」${niceNumber(first.low ?? null)} ~ ${niceNumber(first.high ?? null)}`
  return `${head}；推理时落在区间之外的输入不会报错，树只会给边界上的那个叶值`
}

/** 一条部分依赖曲线折出来的样子。 */
export interface PdpPanel {
  readonly key: string
  readonly name: string
  readonly points: readonly (readonly [number, number])[]
  readonly summary: string
}

/** 曲线两端与升降跨度；点不够时照实说，不画一条假的平线。 */
function pdpSummary(curve: PdpCurve): string {
  const points = curve.points
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) {
    return `「${curve.key}」一个网格点都没有，画不出曲线`
  }
  if (points.length === 1) {
    return `「${curve.key}」在训练集上只有 ${niceNumber(first[0])} 这一个取值，画不出曲线`
  }
  const heights = points.map((point) => point[1])
  const span = Math.max(...heights) - Math.min(...heights)
  return `「${curve.key}」从 ${niceNumber(first[0])} 走到 ${niceNumber(last[0])}，预测值随之从 ${niceNumber(first[1])} 变到 ${niceNumber(last[1])}，上下跨度 ${niceNumber(span)}`
}

export function pdpPanels(payload: Item): PdpPanel[] {
  return structureOf(payload).pdp.map((curve, seat) => ({
    key: `${seat}:${curve.key}`,
    name: curve.key,
    points: curve.points,
    summary: pdpSummary(curve),
  }))
}

/** 解释方差：每条轴占多少、到第几条够用。 */
export interface ExplainedView {
  readonly isBlank: boolean
  readonly rows: readonly BarListItem[]
  readonly curve: readonly (readonly [number, number])[]
  /** 碎石图上那条「够用了」的横线画在哪。 */
  readonly enoughRule: number
  readonly summary: string
}

/** 累计曲线：后端给了就用它的，没给就按每条轴的占比一路加上去。 */
function cumulativeOf(payload: Item, shares: readonly number[]): number[] {
  const given = numbersOf(payload['cumulative'])
  if (given.length === shares.length) return given
  let running = 0
  return shares.map((share) => {
    running += share
    return running
  })
}

/** 到第几条轴累计过了 80%；一条都没过给 0。 */
function enoughAt(cumulative: readonly number[]): number {
  const seat = cumulative.findIndex((value) => value >= ENOUGH)
  return seat < 0 ? 0 : seat + 1
}

export function explainedView(payload: Item): ExplainedView {
  const shares = structureOf(payload).explained
  const names = textsOf(payload['loading_rows'])
  const cumulative = cumulativeOf(payload, shares)
  const enough = enoughAt(cumulative)
  const last = cumulative[cumulative.length - 1]
  const covered = last === undefined ? '—' : percentText(last * 100)
  const reach =
    enough === 0
      ? `${shares.length} 条轴合计也只解释掉 ${covered}，没到 80%`
      : `前 ${enough} 条就过了 80%，${shares.length} 条合计解释掉 ${covered}`
  return {
    isBlank: shares.length === 0,
    rows: shares.map((share, seat) => ({
      name: names[seat] ?? `第 ${seat + 1} 主成分`,
      value: share,
      tone: 'primary',
    })),
    // ⚠ 从「零条轴解释掉零」起画：只画实际那几条时纵轴会从 0.97 起，80% 那条
    // 线整个落在画幅之外，读者看不到「到第几条够用」这件事
    curve: [
      [0, 0],
      ...cumulative.map((value, seat): [number, number] => [seat + 1, value]),
    ],
    enoughRule: ENOUGH,
    summary:
      shares.length === 0
        ? '这一趟没拿到解释方差，碎石图画不出来'
        : `每条轴解释掉的方差比例（0–1）：${reach}`,
  }
}

/** 载荷格里的一格：方块面积 = 绝对值，负载荷画成空心。 */
export interface LoadingCell {
  readonly key: string
  readonly left: number
  readonly top: number
  readonly size: number
  readonly isNegative: boolean
  readonly hint: string
}

interface LoadingLabel {
  readonly key: string
  readonly text: string
  readonly full: string
  readonly x: number
  readonly y: number
}

/** 载荷热力格折出来的样子。 */
export interface LoadingsView {
  readonly isBlank: boolean
  readonly viewBox: string
  readonly rowLabels: readonly LoadingLabel[]
  readonly columnLabels: readonly LoadingLabel[]
  readonly cells: readonly LoadingCell[]
  readonly isCut: boolean
  readonly cutNote: string
  readonly summary: string
}

const BLANK_LOADINGS: LoadingsView = {
  isBlank: true,
  viewBox: '0 0 1 1',
  rowLabels: [],
  columnLabels: [],
  cells: [],
  isCut: false,
  cutNote: '',
  summary: '这一趟没拿到载荷矩阵',
}

/** 一行的名字：后端给了就用它的，没给按第几条轴叫。 */
function rowName(names: readonly string[], seat: number): string {
  return names[seat] ?? `第 ${seat + 1} 主成分`
}

function columnName(names: readonly string[], seat: number): string {
  return names[seat] ?? `第 ${seat + 1} 列`
}

interface Peak {
  readonly size: number
  readonly text: string
}

/** 绝对值最大的那一格：方块面积按它归一，文字结论也点它的名。 */
function peakOf(
  loadings: readonly (readonly number[])[],
  rows: readonly string[],
  columns: readonly string[],
): Peak {
  let size = 0
  let text = ''
  for (const [top, row] of loadings.entries()) {
    for (const [left, value] of row.entries()) {
      if (Math.abs(value) <= size) continue
      size = Math.abs(value)
      text = `「${rowName(rows, top)} × ${columnName(columns, left)}」${niceNumber(value)}`
    }
  }
  return { size, text }
}

function cellsOf(
  loadings: readonly (readonly number[])[],
  names: { rows: readonly string[]; columns: readonly string[] },
  peak: number,
): LoadingCell[] {
  const made: LoadingCell[] = []
  for (const [top, row] of loadings.entries()) {
    for (const [left, value] of row.entries()) {
      const share = peak > 0 ? Math.sqrt(Math.abs(value) / peak) : 0
      const size = (CELL - 3) * share
      made.push({
        key: `${top}:${left}`,
        left: LABEL_WIDTH + left * CELL + (CELL - size) / 2,
        top: HEAD_HEIGHT + top * CELL + (CELL - size) / 2,
        size,
        isNegative: value < 0,
        hint: `${rowName(names.rows, top)} × ${columnName(names.columns, left)}：${niceNumber(value)}`,
      })
    }
  }
  return made
}

/**
 * 载荷矩阵折成一张格子图。
 *
 * ⚠ 行列名必须与矩阵切在同一处：矩阵按上限截了而名字没截的话，每一行都对着错
 * 的那条轴，而图看着完全正常（后端 `pcablocks._pca_structure` 同款口径）。
 * Args: payload。
 */
export function loadingsView(payload: Item): LoadingsView {
  const loadings = structureOf(payload).loadings
  const width = Math.max(0, ...loadings.map((row) => row.length))
  if (loadings.length === 0 || width === 0) return BLANK_LOADINGS
  const names = {
    rows: textsOf(payload['loading_rows']),
    columns: textsOf(payload['loading_columns']),
  }
  const peak = peakOf(loadings, names.rows, names.columns)
  const isCut = payload['is_loadings_cut'] === true
  return {
    isBlank: false,
    viewBox: `0 0 ${LABEL_WIDTH + width * CELL + PAD} ${HEAD_HEIGHT + loadings.length * CELL + PAD}`,
    rowLabels: loadings.map((_, seat) => ({
      key: `r${seat}`,
      text: shortName(rowName(names.rows, seat)),
      full: rowName(names.rows, seat),
      x: LABEL_WIDTH - 6,
      y: HEAD_HEIGHT + seat * CELL + CELL / 2 + 2.5,
    })),
    columnLabels: Array.from({ length: width }, (_, seat) => ({
      key: `c${seat}`,
      text: shortName(columnName(names.columns, seat)),
      full: columnName(names.columns, seat),
      x: LABEL_WIDTH + seat * CELL + CELL / 2,
      y: HEAD_HEIGHT - 5,
    })),
    cells: cellsOf(loadings, names, peak.size),
    isCut,
    cutNote: isCut
      ? `载荷矩阵顶到了上限，只画了前 ${loadings.length} 行 × ${width} 列`
      : '',
    summary:
      peak.size === 0
        ? `${loadings.length} 行 × ${width} 列的载荷全是零，一格都画不出来`
        : `${loadings.length} 行 × ${width} 列；方块面积是载荷的绝对值、空心的是负载荷；最大的一格是 ${peak.text}`,
  }
}

/** 代表树上的一个节点。 */
interface TreeNode {
  readonly id: number
  readonly parent: number
  readonly branch: string
  readonly key: string
  readonly threshold: number | null
  readonly value: number | null
  readonly samples: number
  readonly isLeaf: boolean
}

/** 摆成一层套一层的样子。 */
export interface TreeBranch {
  readonly key: string
  /** 走到这一枝的条件；空串 = 根，没有条件。 */
  readonly condition: string
  readonly text: string
  readonly children: readonly TreeBranch[]
}

export interface TreeView {
  readonly isBlank: boolean
  readonly depth: number
  readonly count: number
  readonly roots: readonly TreeBranch[]
  readonly cutNote: string
  readonly summary: string
}

const BLANK_TREE: TreeView = {
  isBlank: true,
  depth: 0,
  count: 0,
  roots: [],
  cutNote: '',
  summary: '这一步没有拿到代表树',
}

function nodeOf(raw: Item): TreeNode {
  return {
    id: countOf(raw['id']),
    parent: numberOf(raw['parent']) ?? -1,
    branch: textOf(raw['branch']),
    key: textOf(raw['key']),
    threshold: numberOf(raw['threshold']),
    value: numberOf(raw['value']),
    samples: countOf(raw['samples']),
    isLeaf: raw['is_leaf'] === true,
  }
}

/** 走到这一枝的条件。⚠ 条件挂在**父**节点的列与阈值上，不是自己的。 */
function conditionOf(parent: TreeNode | undefined, branch: string): string {
  if (parent === undefined || parent.key === '' || parent.threshold === null) {
    return branch === '' ? '' : '（切分条件读不出来）'
  }
  const sign = branch === 'low' ? '≤' : '>'
  return `${parent.key} ${sign} ${niceNumber(parent.threshold)}`
}

function nodeText(node: TreeNode): string {
  const rows = `${grouped(node.samples)} 行`
  if (node.isLeaf) return `预测 ${niceNumber(node.value)} · ${rows}`
  return node.key === ''
    ? `再切一层 · ${rows}`
    : `再按「${node.key}」切 · ${rows}`
}

/** 一层套一层地摆开。⚠ 带 `seen` 是防自环：一条坏边就能把渲染转死。 */
function branchOf(
  node: TreeNode,
  kids: Map<number, TreeNode[]>,
  parent: TreeNode | undefined,
  seen: Set<number>,
): TreeBranch {
  seen.add(node.id)
  const mine = (kids.get(node.id) ?? []).filter((one) => !seen.has(one.id))
  return {
    key: `n${node.id}`,
    condition: conditionOf(parent, node.branch),
    text: nodeText(node),
    children: mine.map((one) => branchOf(one, kids, node, seen)),
  }
}

/** 按父节点归堆。⚠ 自指的那条边不收：它会让这一枝既是自己的父也是自己的子。 */
function kidsOf(
  nodes: readonly TreeNode[],
  seats: ReadonlySet<number>,
): Map<number, TreeNode[]> {
  const kids = new Map<number, TreeNode[]>()
  for (const node of nodes) {
    if (!seats.has(node.parent) || node.parent === node.id) continue
    kids.set(node.parent, [...(kids.get(node.parent) ?? []), node])
  }
  return kids
}

/** 根节点先按哪一列切在哪个值上——这棵树要回答的就是这一句。 */
function treeSummary(root: TreeNode | undefined, count: number): string {
  if (root === undefined) return '这棵代表树一个节点都没有'
  if (root.isLeaf || root.key === '' || root.threshold === null) {
    return `这棵代表树只有一个节点：${nodeText(root)}`
  }
  return `共 ${count} 个节点：先按「${root.key}」切在 ${niceNumber(root.threshold)} 上，${grouped(root.samples)} 行分成两支`
}

/**
 * 代表树折成一层套一层的样子。
 *
 * Args: payload。
 */
export function treeView(payload: Item): TreeView {
  const raw = structureOf(payload).tree
  if (raw === null) return BLANK_TREE
  const nodes = listOf(raw['nodes']).map((one) => nodeOf(recordOf(one)))
  if (nodes.length === 0) return BLANK_TREE
  const seats = new Set(nodes.map((one) => one.id))
  const owner = new Map<number, TreeNode>(nodes.map((one) => [one.id, one]))
  const kids = kidsOf(nodes, seats)
  const seen = new Set<number>()
  const heads = nodes.filter((one) => !seats.has(one.parent))
  const roots = heads.map((one) => branchOf(one, kids, undefined, seen))
  // 挂不上任何一棵的节点也摆出来：静默丢掉之后，「这一枝没画」与「模型里没有
  // 这一枝」在界面上分不出来
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    roots.push(branchOf(node, kids, owner.get(node.parent), seen))
  }
  const count = nodes.length
  return {
    isBlank: false,
    depth: countOf(raw['depth']),
    count,
    roots,
    cutNote:
      count >= MAX_TREE_NODES
        ? `节点数顶到了上限 ${MAX_TREE_NODES} 个，更深的那几层没有带回来`
        : '',
    summary: treeSummary(heads[0] ?? nodes[0], count),
  }
}
