/**
 * @fileoverview 地址空间浏览树的纯逻辑：懒加载一层、勾选变量节点、生成点位。
 *
 * ⚠ 只有变量节点能当点位，对象节点只用来往下走。勾一个对象节点等于建一个
 * 永远读不到值的点位——所以勾选框只出现在变量节点上。
 *
 * ⚠ 从寻址串推出来的编码只是**建议**：`ns=2;s=Plant1.Line1.OutletTemp` 推出
 * `outlet_temp` 很好用，但推出来的东西撞了名就得让用户改。推不出合法编码时
 * 一律留空，让用户自己填——胡乱补一个 `point_1` 会让点表半年后没人看得懂。
 */
import type { CollectBrowseItem, CollectPointItemInput } from '@dt/contracts'

/** 树上的一个节点。`children` 为 null 表示还没展开过。 */
export interface TreeNode {
  address: string
  name: string
  hasChildren: boolean
  isVariable: boolean
  children: TreeNode[] | null
  isLoading: boolean
  error: string | null
}

/** 把一层浏览结果转成树节点。 */
export function toNodes(items: readonly CollectBrowseItem[]): TreeNode[] {
  return items.map((item) => ({
    address: item.address,
    name: item.name,
    hasChildren: item.has_children,
    isVariable: item.is_variable,
    children: null,
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
