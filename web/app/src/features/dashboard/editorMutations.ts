/**
 * @fileoverview 编辑器草稿的五个变异动作：应用一次文档改动、三种改选中、换基线。
 * 拆在组合式外面，`useDashboardEditor` 只做装配；怎么改节点仍由 `editorDoc.ts`
 * 的纯函数决定，这里只管把改动记进历史并让选中集跟着收敛。
 */
import type { ShallowRef } from 'vue'
import type { DashboardNodePayload } from '@dt/contracts'

import type { EditorHistory } from '@/composables/useEditorHistory'
import { isSameNodeList, sortNodes } from './editorDoc'
import {
  prunedSelection,
  sanitizedSelection,
  toggledSelection,
} from './editorSelection'

/** 一次文档改动：拿当前节点表，给出新的节点表。 */
export type NodeChange = (
  nodes: readonly DashboardNodePayload[],
) => DashboardNodePayload[]

/** 五个动作共用的三份引用，由组合式持有。 */
export interface EditorDraftRefs {
  history: EditorHistory
  /** 保存基线；「脏」按引用与它比。 */
  baseline: ShallowRef<readonly DashboardNodePayload[]>
  /** 选中集，末位是主选中。 */
  selection: ShallowRef<readonly string[]>
}

export interface EditorMutations {
  /**
   * 应用一次改动。
   * @param change 纯函数改动
   * @param mergeKey 连续输入的合并键（`节点:字段`），结构性改动不传
   */
  apply: (change: NodeChange, mergeKey?: string | null) => void
  /** 单选（清掉其余选中）；null 即清空。 */
  select: (nodeId: string | null) => void
  /** Shift 点击的累积多选：在集合里就移出，不在就追加为主选中。 */
  toggleSelect: (nodeId: string) => void
  /** 整体换选中集（框选、全选用）；不存在的 id 被静默剔除。 */
  setSelection: (nodeIds: readonly string[]) => void
  /** 换一份基线：加载完与保存完各一次，历史与脏标记一起归零。 */
  reset: (nodes: readonly DashboardNodePayload[]) => void
}

export function editorMutations(refs: EditorDraftRefs): EditorMutations {
  const { history, baseline, selection } = refs

  return {
    apply: (change, mergeKey = null) => {
      const current = history.present.value
      const next = sortNodes(change(current))
      // ⚠ 逐项比引用而不是无脑记一笔：不比的话「点了但没改动」也会置脏，
      // 于是离开时永远弹一次「有未保存的改动」，用户很快就学会无视它
      if (isSameNodeList(next, current)) return
      history.commit(next, mergeKey)
      // 改动可能删掉了选中的节点，选中集跟着收敛
      selection.value = prunedSelection(selection.value, next)
    },
    select: (nodeId) => {
      // ⚠ 换选中项要关合并窗口：否则在 A 上输入、切到 B 再输入会并成一笔，
      // 一次撤销把两个节点的改动一起撤掉
      history.flush()
      selection.value = nodeId === null ? [] : [nodeId]
    },
    toggleSelect: (nodeId) => {
      history.flush()
      selection.value = toggledSelection(selection.value, nodeId)
    },
    setSelection: (nodeIds) => {
      history.flush()
      selection.value = sanitizedSelection(nodeIds, history.present.value)
    },
    reset: (next) => {
      const sorted = sortNodes(next)
      history.reset(sorted)
      baseline.value = sorted
      selection.value = prunedSelection(selection.value, sorted)
    },
  }
}
