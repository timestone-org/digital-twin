/**
 * @fileoverview 编辑器的草稿状态：一棵节点树、一个选中项、一条撤销栈。
 * 具体怎么改节点由 `pages/DashboardEditor/editorDoc.ts` 的纯函数决定，
 * 这里只管把改动记进历史并派生出画布要的排版。
 *
 * ⚠ 「脏」按**引用**判：文档操作全不可变，保存成功后把基线换成新引用即可，
 * 不必逐字段比对，也就不会出现「比对漏了一个字段所以离开时不提示」。
 */

import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import type { DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

import { useEditorHistory } from '@/composables/useEditorHistory'
import { sortNodes } from '@/features/dashboard/editorDoc'
import { layoutFrames, type EditorLayout } from '@/features/dashboard/editorLayout'

/** 一次文档改动：拿当前节点表，给出新的节点表。 */
export type NodeChange = (
  nodes: readonly DashboardNodePayload[],
) => DashboardNodePayload[]

export interface DashboardEditor {
  nodes: ComputedRef<readonly DashboardNodePayload[]>
  selectedId: Ref<string | null>
  selected: ComputedRef<DashboardNodePayload | null>
  layout: ComputedRef<EditorLayout>
  isDirty: ComputedRef<boolean>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /**
   * 应用一次改动。
   * @param change 纯函数改动
   * @param mergeKey 连续输入的合并键（`节点:字段`），结构性改动不传
   */
  apply: (change: NodeChange, mergeKey?: string | null) => void
  /** 关掉合并窗口。切换选中项、下笔之前用。 */
  flush: () => void
  undo: () => void
  redo: () => void
  select: (nodeId: string | null) => void
  /** 换一份基线：加载完与保存完各一次，历史与脏标记一起归零。 */
  reset: (nodes: readonly DashboardNodePayload[]) => void
}

/** 两份节点表逐项同引用即视为没改动。 */
function isSameNodes(
  next: readonly DashboardNodePayload[],
  current: readonly DashboardNodePayload[],
): boolean {
  return (
    next.length === current.length &&
    next.every((node, at) => node === current[at])
  )
}

/**
 * @param getManifest 注入式清单解析器，排版要靠它认出容器
 */
export function useDashboardEditor(
  getManifest: GetModuleManifest,
): DashboardEditor {
  const history = useEditorHistory([])
  // ⚠ 基线用 shallowRef：`ref` 会把数组深包成响应式代理，代理与原数组永远不是
  // 同一个引用，于是「脏」恒为真——刚加载完就提示有未保存的改动
  const baseline = shallowRef<readonly DashboardNodePayload[]>([])
  const selectedId = ref<string | null>(null)

  const nodes = computed(() => history.present.value)

  const selected = computed(
    () => nodes.value.find((node) => node.id === selectedId.value) ?? null,
  )

  const layout = computed(() => layoutFrames(nodes.value, getManifest))

  const isDirty = computed(() => nodes.value !== baseline.value)

  function apply(change: NodeChange, mergeKey: string | null = null): void {
    const next = sortNodes(change(nodes.value))
    // ⚠ 逐项比引用而不是无脑记一笔：不比的话「点了但没改动」也会置脏，
    // 于是离开时永远弹一次「有未保存的改动」，用户很快就学会无视它
    if (isSameNodes(next, nodes.value)) return
    history.commit(next, mergeKey)
  }

  function select(nodeId: string | null): void {
    // ⚠ 换选中项要关合并窗口：否则在 A 上输入、切到 B 再输入会并成一笔，
    // 一次撤销把两个节点的改动一起撤掉
    history.flush()
    selectedId.value = nodeId
  }

  function reset(next: readonly DashboardNodePayload[]): void {
    const sorted = sortNodes(next)
    history.reset(sorted)
    baseline.value = sorted
    if (!sorted.some((node) => node.id === selectedId.value)) {
      selectedId.value = null
    }
  }

  return {
    nodes,
    selectedId,
    selected,
    layout,
    isDirty,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    apply,
    flush: history.flush,
    undo: history.undo,
    redo: history.redo,
    select,
    reset,
  }
}
