/**
 * @fileoverview 地址空间浏览树的纯逻辑：懒加载一层、勾选、按子树批量勾选、
 * 生成点位。
 *
 * ⚠ 只有变量节点能当点位，对象节点只用来往下走。勾一个对象节点**不是**把它
 * 自己建成点位（那会建出一个永远读不到值的配置），而是把它**下面的变量**全勾上。
 *
 * ⚠ 「已加载」与「展开着」是两件事，故 `children` 与 `isOpen` 分开存：合成一个
 * 的话，收起一次就等于把子树丢掉，再展开又要打一趟设备——而地址空间浏览对 PLC
 * 是实打实的负载。
 *
 * ⚠ 从寻址串推出来的编码只是**建议**：`ns=2;s=Plant1.Line1.OutletTemp` 推出
 * `outlet_temp` 很好用，但推出来的东西撞了名就得让用户改。推不出合法编码时
 * 一律留空，让用户自己填——胡乱补一个 `point_1` 会让点表半年后没人看得懂。
 */
import type { CollectBrowseItem, CollectPointItemInput } from '@dt/contracts'

/** 树上的一个节点。 */
export interface TreeNode {
  address: string
  name: string
  hasChildren: boolean
  isVariable: boolean
  /** `null` 表示这一层还没拉过；拉过之后即使收起也留着。 */
  children: TreeNode[] | null
  /** 拉过之后是否展开显示。 */
  isOpen: boolean
  isLoading: boolean
  error: string | null
}

/**
 * 一个节点的勾选态。
 * ⚠ `some` 同时表达两件事：「勾了一部分」与「下面还有没拉回来的、不敢说全勾」。
 * 把后者显示成 `all` 是在替用户担保他没看过的那些点位。
 */
export type NodeSelection = 'none' | 'some' | 'all'

/** 把一层浏览结果转成树节点。 */
export function toNodes(items: readonly CollectBrowseItem[]): TreeNode[] {
  return items.map((item) => ({
    address: item.address,
    name: item.name,
    hasChildren: item.has_children,
    isVariable: item.is_variable,
    children: null,
    isOpen: false,
    isLoading: false,
    error: null,
  }))
}

/** 深度优先找一个节点；找不到返回 null。 */
export function findNode(
  nodes: readonly TreeNode[],
  address: string,
): TreeNode | null {
  for (const node of nodes) {
    if (node.address === address) return node
    const found = node.children === null ? null : findNode(node.children, address)
    if (found !== null) return found
  }
  return null
}

/** 收集树上全部变量节点，按地址索引。勾选后要按地址取回它的名字。 */
export function variableIndex(
  nodes: readonly TreeNode[],
  found: Map<string, TreeNode> = new Map(),
): Map<string, TreeNode> {
  for (const node of nodes) {
    if (node.isVariable) found.set(node.address, node)
    if (node.children !== null) variableIndex(node.children, found)
  }
  return found
}

/**
 * 一棵子树（含自己）里**已经拉回来的**变量节点。
 * @param node 子树的根
 */
export function variablesUnder(node: TreeNode): TreeNode[] {
  const found: TreeNode[] = []
  walk(node, (one) => {
    if (one.isVariable) found.push(one)
  })
  return found
}

/**
 * 一棵子树里还没拉过子层的节点（含自己）。它们就是「全选」要补拉的那些。
 * @param node 子树的根
 */
export function unloadedUnder(node: TreeNode): TreeNode[] {
  const found: TreeNode[] = []
  walk(node, (one) => {
    if (one.hasChildren && one.children === null) found.push(one)
  })
  return found
}

function walk(node: TreeNode, visit: (one: TreeNode) => void): void {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/**
 * 一棵树上每个节点的勾选态，一趟后序算完。
 *
 * ⚠ 不做成「每个节点各自递归求一次」：那是 O(n²)，几千个节点的地址空间上
 * 每次勾选都要卡一下。
 * @param nodes 树的根一层
 * @param selected 已勾选的寻址串
 * @param taken 已经建过点位的寻址串，不计入「该勾而没勾」
 */
export function selectionStates(
  nodes: readonly TreeNode[],
  selected: ReadonlySet<string>,
  taken: ReadonlySet<string> = new Set(),
): Map<string, NodeSelection> {
  const states = new Map<string, NodeSelection>()
  for (const node of nodes) fill(node, selected, taken, states)
  return states
}

/** 后序填一个节点的态，返回 (可选的变量数, 已勾的变量数, 是否全拉过)。 */
function fill(
  node: TreeNode,
  selected: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  states: Map<string, NodeSelection>,
): { total: number; picked: number; isComplete: boolean } {
  if (node.isVariable) {
    const isPicked = selected.has(node.address)
    states.set(node.address, isPicked ? 'all' : 'none')
    // 已建过点位的不算「该勾而没勾」，否则它会让上层永远停在半选
    const total = taken.has(node.address) ? 0 : 1
    return { total, picked: isPicked && total === 1 ? 1 : 0, isComplete: true }
  }
  let total = 0
  let picked = 0
  let isComplete = !node.hasChildren || node.children !== null
  for (const child of node.children ?? []) {
    const part = fill(child, selected, taken, states)
    total += part.total
    picked += part.picked
    isComplete = isComplete && part.isComplete
  }
  states.set(node.address, verdict(total, picked, isComplete))
  return { total, picked, isComplete }
}

function verdict(
  total: number,
  picked: number,
  isComplete: boolean,
): NodeSelection {
  if (picked === 0) return 'none'
  // 子树没拉全时最多只能说「勾了一部分」——说 all 就是替用户担保他没看过的那些
  return picked === total && isComplete ? 'all' : 'some'
}

/** 编码里允许的字符；其余一律当分隔符。 */
const SEPARATORS = /[^A-Za-z0-9]+/g

/**
 * 从寻址串猜一个点位编码；猜不出合法的就返回空串。
 *
 * 取最后一段（`ns=2;s=A.B.OutletTemp` → `OutletTemp`）再转成下划线小写。
 * @param address 协议寻址串
 */
export function suggestCode(address: string): string {
  const tail = address.split(/[.;/]/).at(-1) ?? ''
  const body = tail
    .replace(/^[A-Za-z]+=/, '')
    .replace(SEPARATORS, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  return /^[a-z0-9]/.test(body) ? body : ''
}

/**
 * 把勾选的变量节点转成可提交的点位。
 * @param selected 勾选的地址
 * @param index 地址 → 节点
 * @param taken 已被占用的编码（库里已有 + 本次已生成）
 */
export function toPointItems(
  selected: readonly string[],
  index: ReadonlyMap<string, TreeNode>,
  taken: ReadonlySet<string>,
): { items: CollectPointItemInput[]; skipped: string[] } {
  const items: CollectPointItemInput[] = []
  const skipped: string[] = []
  const used = new Set(taken)
  for (const address of selected) {
    const node = index.get(address)
    if (node === undefined) continue
    const code = uniqueCode(suggestCode(address), used)
    if (code === '') {
      skipped.push(address)
      continue
    }
    used.add(code)
    items.push({ code, name: node.name, address })
  }
  return { items, skipped }
}

/** 撞名时挂一个序号后缀；猜不出编码时返回空串交给调用方跳过。 */
function uniqueCode(base: string, used: ReadonlySet<string>): string {
  if (base === '') return ''
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return ''
}
