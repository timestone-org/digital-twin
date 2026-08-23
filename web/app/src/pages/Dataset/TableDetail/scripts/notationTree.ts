/**
 * @fileoverview 记号树的取字段助手。树是后端 `formula:validate` 给的一团自由
 * JSON（递归结构，契约里就是 `Record<string, unknown>`），这里负责把它安全地
 * 读成渲染要用的几种基本形状。
 *
 * ⚠ 每一个取法都**只降级不抛错**：后端加了一种新记号、或者某个节点少了个子
 * 字段，渲染器读到的是 `undefined`，递归下去撞上 `.t` 就是一个 TypeError，
 * 而那会把整个列表单弹窗打成白屏——正是占位符要避免的症状
 * （docs/DATASET_DESIGN.md §5.9、§7.13）。
 */

/** 树上的一个节点。`t` 是判别字段，每个 dict 都带，连 `arm` 也带。 */
export type NotationNode = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 收成一个可分派的节点：不是对象、或者没有字符串 `t`，一律当认不出。
 * @param value 树上任意一处的值
 */
export function asNode(value: unknown): NotationNode | null {
  if (!isRecord(value)) return null
  return typeof value['t'] === 'string' ? value : null
}

/**
 * 节点类型；认不出时给空串，渲染器据此走占位分支。
 * @param value 树上任意一处的值
 */
export function nodeKind(value: unknown): string {
  const node = asNode(value)
  if (node === null) return ''
  const kind = node['t']
  return typeof kind === 'string' ? kind : ''
}

/**
 * 读一个字符串字段；不是字符串就给空串。
 * @param node 节点
 * @param field 字段名
 */
export function nodeText(node: NotationNode | null, field: string): string {
  const value = node?.[field]
  return typeof value === 'string' ? value : ''
}

/**
 * 读一个整数字段；不是有限数就给缺省值。
 * @param node 节点
 * @param field 字段名
 * @param fallback 读不到时用什么
 */
export function nodeNumber(
  node: NotationNode | null,
  field: string,
  fallback: number,
): number {
  const value = node?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 读一个子节点位；读不到就给 null，渲染器会画成占位符。
 * @param node 节点
 * @param field 字段名
 */
export function nodeChild(node: NotationNode | null, field: string): unknown {
  return node?.[field] ?? null
}

/** 子节点连同它在兄弟里的位次。位次即身份：记号树是有序的，第几档就是第几档。 */
export interface NotationSlot {
  at: number
  node: unknown
}

/**
 * 读一个子节点数组，带上各自的位次；不是数组就给空表。
 * @param node 节点
 * @param field 字段名
 */
export function nodeSlots(
  node: NotationNode | null,
  field: string,
): NotationSlot[] {
  const value = node?.[field]
  if (!isNodeList(value)) return []
  return value.map((one, at) => ({ at, node: one }))
}

/** ⚠ 收成 `unknown[]` 而不是直接用 `Array.isArray`：后者把元素窄成 `any`。 */
function isNodeList(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * 这个节点的子节点数组在不在。
 * ⚠ 不在时整块要降级成占位，**不能只当成空表**：`fn` 的 `args` 丢了就会画出一个
 * `ABS()`，看着像一个真的零参函数，而那是一句凭空编出来的读法。
 * @param node 节点
 * @param field 字段名
 */
export function hasNodeList(node: NotationNode | null, field: string): boolean {
  return isNodeList(node?.[field])
}
