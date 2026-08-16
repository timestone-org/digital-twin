/**
 * @fileoverview 地址空间树的状态与动作：拉一层、展开/收起、逐个勾选、按子树
 * 批量勾选。
 *
 * ⚠ 手动展开一次只走一层：递归遍历整棵地址空间对 PLC 是实打实的负载，几万个
 * 节点的设备会把一次「展开」拖成分钟级。勾上层的框会递归补拉，但**有硬上限**，
 * 到顶就停下并让调用方如实说出来——静默只勾一半是最坏的结果。
 *
 * ⚠ 收起**不丢**已经拉回来的子树：丢了的话再展开又要打一趟设备。
 *
 * 每个动作都是模块级函数、显式收一个 `ctx`：composable 只负责把几个 ref 接起来。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import {
  findNode,
  selectionStates,
  toNodes,
  unloadedUnder,
  variableIndex,
  variablesUnder,
  type NodeSelection,
  type TreeNode,
} from './browseTree'

/**
 * 勾上层节点时最多补拉多少个节点的子层。
 * ⚠ 没有这条线，勾一次根节点就是把整棵地址空间遍历一遍——几万个节点的设备上
 * 那是分钟级的设备负载，而界面看起来只是卡住了。
 */
export const MAX_SUBTREE_NODES = 500

interface Ctx {
  sourceId: () => string
  taken: Ref<Set<string>>
  roots: Ref<TreeNode[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  selected: Ref<Set<string>>
  states: ComputedRef<Map<string, NodeSelection>>
}

export interface BrowseTree {
  roots: Ref<TreeNode[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  selected: Ref<Set<string>>
  /** 每个节点的勾选态，按寻址串查。 */
  states: ComputedRef<Map<string, NodeSelection>>
  /** 树上全部变量节点，按寻址串索引。 */
  index: ComputedRef<Map<string, TreeNode>>
  selectedCount: ComputedRef<number>
  /** 重新拉根一层。 */
  loadRoot: () => Promise<void>
  /** 展开或收起一个节点。 */
  expand: (address: string) => Promise<void>
  /**
   * 勾一个节点。变量只勾它自己；上层勾的是它下面的全部变量。
   * 返回是否**整棵子树都拉全了**——没拉全时调用方要如实告诉用户。
   */
  toggle: (address: string) => Promise<boolean>
  /** 全部取消勾选。建完点位之后用。 */
  clear: () => void
}

async function loadRoot(ctx: Ctx): Promise<void> {
  ctx.loading.value = true
  ctx.error.value = null
  try {
    const result = await collect.browseSource(ctx.sourceId(), null)
    ctx.roots.value = toNodes(result.items)
  } catch (caught) {
    ctx.error.value = describeError(caught)
    ctx.roots.value = []
  } finally {
    ctx.loading.value = false
  }
}

/** 拉一个节点的下一层。失败就把原因挂在这个节点上，不掀翻整棵树。 */
async function loadChildren(ctx: Ctx, node: TreeNode): Promise<boolean> {
  node.isLoading = true
  node.error = null
  try {
    const result = await collect.browseSource(ctx.sourceId(), node.address)
    node.children = toNodes(result.items)
    return true
  } catch (caught) {
    node.error = describeError(caught)
    return false
  } finally {
    node.isLoading = false
  }
}

async function expand(ctx: Ctx, address: string): Promise<void> {
  const node = findNode(ctx.roots.value, address)
  if (node === null || node.isLoading) return
  if (node.children !== null) {
    node.isOpen = !node.isOpen
    return
  }
  await loadChildren(ctx, node)
  node.isOpen = node.children !== null
}

/**
 * 把一棵子树里没拉过的层补拉回来，返回是否拉全了。
 * ⚠ 逐个顺序拉、不并发：并发等于同时向 PLC 开一堆浏览请求，而它本来就是
 * 单会话在扛。
 */
async function loadSubtree(ctx: Ctx, node: TreeNode): Promise<boolean> {
  let budget = MAX_SUBTREE_NODES
  for (;;) {
    const next = unloadedUnder(node)[0]
    if (next === undefined) return true
    if (budget <= 0) return false
    budget -= 1
    // ⚠ 拉失败时 children 仍是 null，下一轮还会挑中它——不停就是死循环
    if (!(await loadChildren(ctx, next))) return false
  }
}

/** 把子树里已加载的变量全勾上或全取消。已建过点位的跳过。 */
function pick(ctx: Ctx, node: TreeNode, isOn: boolean): void {
  const next = new Set(ctx.selected.value)
  for (const one of variablesUnder(node)) {
    if (ctx.taken.value.has(one.address)) continue
    if (isOn) next.add(one.address)
    else next.delete(one.address)
  }
  ctx.selected.value = next
}

function toggleOne(ctx: Ctx, address: string): void {
  const next = new Set(ctx.selected.value)
  if (next.has(address)) next.delete(address)
  else next.add(address)
  ctx.selected.value = next
}

async function toggle(ctx: Ctx, address: string): Promise<boolean> {
  const node = findNode(ctx.roots.value, address)
  if (node === null) return true
  if (node.isVariable) {
    toggleOne(ctx, address)
    return true
  }
  if (node.isLoading) return true
  // 已经全勾上时取消，不必再打设备
  if (ctx.states.value.get(address) === 'all') {
    pick(ctx, node, false)
    return true
  }
  const isWhole = await loadSubtree(ctx, node)
  node.isOpen = true
  pick(ctx, node, true)
  return isWhole
}

/**
 * 造一棵可浏览的地址空间树。
 * @param sourceId 取当前数据源 id
 * @param taken 已经建过点位的寻址串；批量勾选会跳过它们
 */
export function useBrowseTree(
  sourceId: () => string,
  taken: Ref<Set<string>>,
): BrowseTree {
  const roots = ref<TreeNode[]>([])
  const selected = ref(new Set<string>())
  const states = computed(() =>
    selectionStates(roots.value, selected.value, taken.value),
  )
  const ctx: Ctx = {
    sourceId,
    taken,
    roots,
    loading: ref(false),
    error: ref<string | null>(null),
    selected,
    states,
  }
  return {
    roots,
    loading: ctx.loading,
    error: ctx.error,
    selected,
    states,
    index: computed(() => variableIndex(roots.value)),
    selectedCount: computed(() => selected.value.size),
    loadRoot: () => loadRoot(ctx),
    expand: (address) => expand(ctx, address),
    toggle: (address) => toggle(ctx, address),
    clear: () => (selected.value = new Set()),
  }
}
