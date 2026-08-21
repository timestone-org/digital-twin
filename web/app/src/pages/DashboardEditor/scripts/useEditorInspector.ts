/**
 * @fileoverview 右栏四页签要用的那几样：大屏级卡片外观缺省，以及
 * 「改名 / 层序 / 应用预设」三个只作用于当前选中节点的动作。
 * 页面只负责接线，判定全在这里，这样「一次操作 = 一笔撤销」的口径仍只有一处。
 */
import type { CardChrome, ConfigPreset } from '@dt/contracts'
import { mergeCardChrome } from '@dt/runtime'
import { computed, type ComputedRef } from 'vue'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { isUniformType } from '@/features/dashboard/batchConfig'
import { mergeConfigBatch } from '@/features/dashboard/editorDoc'
import type { EditorActions } from './editorActions'
import type { EditorMeta } from './useEditorMeta'
import type { EditorSurface } from './useEditorSurface'

/** 层序动作；居中不改文档，只把视口滚过去。 */
export type OrderKind = 'front' | 'forward' | 'backward' | 'back' | 'center'

export interface EditorInspectorDeps {
  editor: DashboardEditor
  actions: EditorActions
  surface: EditorSurface
  meta: EditorMeta
  /** 把某个节点滚进视口中央，由画布提供。 */
  centerOn: (nodeId: string) => void
}

export interface EditorInspector {
  cardChrome: ComputedRef<CardChrome>
  rename: (name: string) => void
  order: (kind: OrderKind) => void
  applyPreset: (preset: ConfigPreset) => void
}

export function createEditorInspector(
  deps: EditorInspectorDeps,
): EditorInspector {
  const { editor, actions, surface, meta } = deps

  return {
    /**
     * 画布与预览共用这一份——读的是**草稿**而不是已保存的大屏，
     * 右栏一改画布当场跟着变。
     */
    cardChrome: computed(() =>
      mergeCardChrome(meta.draft.value?.chromeJson.card, null),
    ),

    rename: (name) => {
      const nodeId = editor.selectedId.value
      if (nodeId !== null) surface.onRename(nodeId, name)
    },

    order: (kind) => {
      const nodeId = editor.selectedId.value
      if (nodeId === null) return
      if (kind === 'front') surface.onFront(nodeId)
      else if (kind === 'back') surface.onBack(nodeId)
      else if (kind === 'forward') surface.onForward(nodeId)
      else if (kind === 'backward') surface.onBackward(nodeId)
      else deps.centerOn(nodeId)
    },

    /**
     * 外观预设：**浅合并**落库，预设没提到的键（标题、绑定、容器栅格）原样保留。
     * 整包替换会静默抹掉它们，而面板上看不出少了什么。
     * 多选同类型时对全体各自浅合并——每个节点合的是**自己**的 configJson，
     * 一次 apply 一步撤销。
     */
    applyPreset: (preset) => {
      const node = editor.selected.value
      if (node === null) return
      const targets = editor.selectedNodes.value
      if (targets.length > 1 && isUniformType(targets)) {
        const ids = editor.selectedIds.value
        editor.apply((nodes) => mergeConfigBatch(nodes, ids, preset.config))
        return
      }
      actions.changeConfig([], { ...node.configJson, ...preset.config }, false)
    },
  }
}
