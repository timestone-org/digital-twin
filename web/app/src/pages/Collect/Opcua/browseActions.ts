/**
 * @fileoverview 地址空间树上的几个动作：拉根一层、展开一层、一次收齐一棵
 * 子树、勾选。
 *
 * ⚠ 手动展开一次只走一层：递归遍历整棵地址空间对 PLC 是实打实的负载，几万个
 * 节点的设备会把一次「展开」拖成分钟级。
 *
 * ⚠ 勾上层节点走的是**一次**子树接口，不是在这里逐层补拉：逐层补拉一个几百
 * 节点的通道，就是几百个串行请求，每一个都要过一遍边缘、总线与设备——现场看到
 * 的只是界面卡住。采集侧不限条数，只受这次请求的时间约束；到点没走完它会说，
 * 调用方要如实转达。
 *
 * ⚠ 收起**不丢**已经拉回来的子树：丢了的话再展开又要打一趟设备。
 *
 * 每个动作都是模块级函数、显式收一个 `Ctx`：composable 只负责把几个 ref 接起来。
 */
import type { Ref } from 'vue'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import {
  findNode,
  graftSubtree,
  toNodes,
  unloadedUnder,
  variablesUnder,
  type NodeSelection,
  type TreeNode,
} from './browseTree'

/** 动作共用的那几个 ref。 */
export interface Ctx {
  sourceId: () => string
  taken: Ref<Set<string>>
  roots: Ref<TreeNode[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  selected: Ref<Set<string>>
  states: ReadonlyMap<string, NodeSelection>
}

/**
 * 勾一下的结果。
 * ⚠ 四个字段各说各的事：勾了等于没勾（`changed` 为 0）与只勾上一半
 * （`isWhole` 为假）在界面上要说成两句不同的话，合并成一个布尔就只剩「好像
 * 没反应」。
 */
export interface ToggleOutcome {
  /** 整棵子树都在手上吗。为假说明采集侧在这次请求的预算内没走完。 */
  isWhole: boolean
  /** 这一下真正改了多少个变量的勾选。 */
  changed: number
  /** 这棵子树里一共有多少个变量（含已经建过点位的）。 */
  total: number
  /** 拉子树时出的错；没有就是 null。 */
  error: string | null
}

const NOOP: ToggleOutcome = {
  isWhole: true,
  changed: 0,
  total: 0,
  error: null,
}

export async function loadRoot(ctx: Ctx): Promise<void> {
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
async function loadChildren(ctx: Ctx, node: TreeNode): Promise<void> {
  node.isLoading = true
  node.error = null
  try {
    const result = await collect.browseSource(ctx.sourceId(), node.address)
    node.children = toNodes(result.items)
    // ⚠ 驱动把「不是变量」一律当成「有子节点」，空文件夹因此也长着箭头和
    // 勾选框；真拉回来是空的就地纠正，免得它再骗人一次
    node.hasChildren = result.items.length > 0
  } catch (caught) {
    node.error = describeError(caught)
  } finally {
    node.isLoading = false
  }
}

export async function expand(ctx: Ctx, address: string): Promise<void> {
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
 * 一次把整棵子树收回来，接到树上。
 * ⚠ 已经全在手上就不再打设备：用户逐层展开过的那些，再问一遍是白跑。
 */
async function loadSubtree(ctx: Ctx, node: TreeNode): Promise<ToggleOutcome> {
  if (unloadedUnder(node).length === 0) return NOOP
  node.isLoading = true
  node.error = null
  try {
    const result = await collect.browseSubtree(ctx.sourceId(), node.address)
    const isWhole = !result.is_truncated
    graftSubtree(node, result.items, isWhole)
    return { ...NOOP, isWhole }
  } catch (caught) {
    const message = describeError(caught)
    node.error = message
    return { ...NOOP, error: message }
  } finally {
    node.isLoading = false
  }
}

/** 把子树里的变量全勾上或全取消，返回真正改了几个。已建过点位的跳过。 */
function pick(ctx: Ctx, node: TreeNode, isOn: boolean): number {
  const next = new Set(ctx.selected.value)
  const before = next.size
  for (const one of variablesUnder(node)) {
    if (ctx.taken.value.has(one.address)) continue
    if (isOn) next.add(one.address)
    else next.delete(one.address)
  }
  ctx.selected.value = next
  return Math.abs(next.size - before)
}

function toggleOne(ctx: Ctx, address: string): void {
  const next = new Set(ctx.selected.value)
  if (next.has(address)) next.delete(address)
  else next.add(address)
  ctx.selected.value = next
}

export async function toggle(
  ctx: Ctx,
  address: string,
): Promise<ToggleOutcome> {
  const node = findNode(ctx.roots.value, address)
  if (node === null || node.isLoading) return NOOP
  if (node.isVariable) {
    toggleOne(ctx, address)
    return { isWhole: true, changed: 1, total: 1, error: null }
  }
  // 已经全勾上时取消，不必再打设备
  if (ctx.states.get(address) === 'all') {
    return outcomeOf(true, pick(ctx, node, false), node)
  }
  const loaded = await loadSubtree(ctx, node)
  if (loaded.error !== null) return loaded
  node.isOpen = true
  return outcomeOf(loaded.isWhole, pick(ctx, node, true), node)
}

function outcomeOf(
  isWhole: boolean,
  changed: number,
  node: TreeNode,
): ToggleOutcome {
  return { isWhole, changed, total: variablesUnder(node).length, error: null }
}
