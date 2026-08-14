/**
 * @fileoverview 编辑器的草稿状态：一棵节点树、一个选中集、一条撤销栈。
 * 具体怎么改节点由 `features/dashboard/editorDoc.ts` 的纯函数决定，
 * 这里只管把改动记进历史并派生出画布要的排版。
 *
 * ⚠ 「脏」按**引用**判：文档操作全不可变，保存成功后把基线换成新引用即可，
 * 不必逐字段比对，也就不会出现「比对漏了一个字段所以离开时不提示」。
 */

import { computed, shallowRef, type ComputedRef } from 'vue'
import type { DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

import { useEditorHistory } from '@/composables/useEditorHistory'
import {
  layoutFrames,
  type EditorLayout,
} from '@/features/dashboard/editorLayout'
import {
  editorMutations,
  type EditorMutations,
} from '@/features/dashboard/editorMutations'

export type { NodeChange } from '@/features/dashboard/editorMutations'

export interface DashboardEditor extends EditorMutations {
  nodes: ComputedRef<readonly DashboardNodePayload[]>
  /** 主选中项：选中集里最后点的那个；面板与绑点都跟着它走。 */
  selectedId: ComputedRef<string | null>
  selected: ComputedRef<DashboardNodePayload | null>
  /** 选中集，按点选先后排序。 */
  selectedIds: ComputedRef<readonly string[]>
  selectedNodes: ComputedRef<readonly DashboardNodePayload[]>
  layout: ComputedRef<EditorLayout>
  isDirty: ComputedRef<boolean>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** 关掉合并窗口。切换选中项、下笔之前用。 */
  flush: () => void
  undo: () => void
  redo: () => void
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
  // 选中集同理用 shallowRef 换整个数组，末位是主选中
  const selection = shallowRef<readonly string[]>([])

  const nodes = computed(() => history.present.value)

  const selectedIds = computed(() => selection.value)

  const selectedId = computed(
    () => selection.value[selection.value.length - 1] ?? null,
  )

  const selected = computed(
    () => nodes.value.find((node) => node.id === selectedId.value) ?? null,
  )

  const selectedNodes = computed(() => {
    const wanted = new Set(selection.value)
    return nodes.value.filter((node) => wanted.has(node.id))
  })

  const layout = computed(() => layoutFrames(nodes.value, getManifest))

  const isDirty = computed(() => nodes.value !== baseline.value)

  return {
    nodes,
    selectedId,
    selected,
    selectedIds,
    selectedNodes,
    layout,
    isDirty,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    flush: history.flush,
    undo: history.undo,
    redo: history.redo,
    ...editorMutations({ history, baseline, selection }),
  }
}
