/**
 * @fileoverview 地址空间树的组合式接口：把几个 ref 接成一棵可浏览的树。
 *
 * 动作本身在 `browseActions.ts`——它们是模块级函数、显式收一个 `Ctx`，
 * 这里只负责造 ref 与把动作绑上去。
 */
import {
  computed,
  reactive,
  ref,
  toRaw,
  watchEffect,
  type ComputedRef,
  type Ref,
} from 'vue'

import {
  expand,
  loadRoot,
  toggle,
  type Ctx,
  type ToggleOutcome,
} from './browseActions'
import {
  selectionStates,
  variableIndex,
  type NodeSelection,
  type TreeNode,
} from './browseTree'

export type { ToggleOutcome } from './browseActions'

export interface BrowseTree {
  roots: Ref<TreeNode[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  selected: Ref<Set<string>>
  /**
   * 每个节点的勾选态，按寻址串查。
   * ⚠ 它是一张**身份长期不变**的响应式表，不是每次算一张新的：见 `applyStates`。
   */
  states: ReadonlyMap<string, NodeSelection>
  /** 树上全部变量节点，按寻址串索引。 */
  index: ComputedRef<Map<string, TreeNode>>
  selectedCount: ComputedRef<number>
  /** 重新拉根一层。 */
  loadRoot: () => Promise<void>
  /** 展开或收起一个节点。 */
  expand: (address: string) => Promise<void>
  /** 勾一个节点。变量只勾它自己；上层勾的是它下面的全部变量。 */
  toggle: (address: string) => Promise<ToggleOutcome>
  /** 全部取消勾选。建完点位之后用。 */
  clear: () => void
}

/**
 * 把新算出来的勾选态搬进那张长期存在的表，只动真正变了的键。
 *
 * ⚠ 不能换一张新 Map：prop 的身份一变，**树上每一个节点都会跟着重渲染一遍**。
 * 几万点位的设备上这就是勾一下几百 MB 的 vnode，堆一满整块内容就没了——而堆
 * 溢出不是可捕获的异常，控制台连一行报错都不会有。
 *
 * ⚠ 读要走 `toRaw`：在 watchEffect 里读这张响应式表等于把自己也订上，写回去
 * 就自触发。
 * @param into 长期存在的那张表
 * @param next 这一轮算出来的态
 */
function applyStates(
  into: Map<string, NodeSelection>,
  next: ReadonlyMap<string, NodeSelection>,
): void {
  const raw = toRaw(into)
  for (const [address, state] of next) {
    if (raw.get(address) !== state) into.set(address, state)
  }
  for (const address of [...raw.keys()]) {
    if (!next.has(address)) into.delete(address)
  }
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
  const states = reactive(new Map<string, NodeSelection>())
  watchEffect(() =>
    applyStates(
      states,
      selectionStates(roots.value, selected.value, taken.value),
    ),
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
