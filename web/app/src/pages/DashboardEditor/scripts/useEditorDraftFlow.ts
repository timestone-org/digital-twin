/**
 * @fileoverview 本地自动草稿的生命周期：脏着每 10 秒落一次、关页前兜底一次、
 * 进屏时提议恢复（恢复是一步可撤销的改动）。
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import {
  DRAFT_INTERVAL_MS,
  clearDraft,
  readDraft,
  writeDraft,
} from './editorDraft'

export interface DraftFlowDeps {
  editor: DashboardEditor
  dashboard: Ref<DashboardPayload | null>
  confirm: {
    ask: (input: {
      title: string
      message: string
      confirmText: string
      danger: boolean
    }) => Promise<boolean>
  }
}

/** 装上草稿流；返回「立即落一次」给保存链路复用。 */
export function useEditorDraftFlow(deps: DraftFlowDeps): {
  flushDraft: () => void
} {
  const { editor, dashboard } = deps
  let draftTimer: ReturnType<typeof setInterval> | null = null

  function flushDraft(): void {
    const current = dashboard.value
    if (current === null || !editor.isDirty.value) return
    writeDraft(current.id, current.updatedAt, editor.nodes.value)
  }

  // ⚠ 恢复走一次 apply：它成为一步可撤销的改动，撤销 = 丢弃草稿回服务端版本
  async function offerRestore(current: DashboardPayload): Promise<void> {
    const draft = readDraft(current.id, current.updatedAt)
    if (draft === null) return
    const restore = await deps.confirm.ask({
      title: '恢复本地草稿',
      message:
        '这张屏上次编辑时留有未保存的草稿，要恢复吗？恢复后可用撤销丢弃。',
      confirmText: '恢复',
      danger: false,
    })
    if (restore) {
      editor.apply(() => draft.nodes)
    } else {
      clearDraft(current.id)
    }
  }

  watch(
    () => dashboard.value?.id ?? null,
    () => {
      const current = dashboard.value
      if (current !== null) void offerRestore(current)
    },
  )

  onMounted(() => {
    draftTimer = setInterval(flushDraft, DRAFT_INTERVAL_MS)
    window.addEventListener('beforeunload', flushDraft)
    const current = dashboard.value
    if (current !== null) void offerRestore(current)
  })

  onBeforeUnmount(() => {
    if (draftTimer !== null) clearInterval(draftTimer)
    draftTimer = null
    window.removeEventListener('beforeunload', flushDraft)
    flushDraft()
  })

  return { flushDraft }
}
