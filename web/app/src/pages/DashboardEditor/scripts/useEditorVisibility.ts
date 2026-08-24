/**
 * @fileoverview 大屏编辑器的本地显隐装配：投影画布节点、重算排版，并在换屏或
 * 重新加载时清掉图层眼睛留下的临时状态。
 */
import type { GetModuleManifest } from '@dt/runtime'
import { computed, ref, watch, type Ref } from 'vue'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { layoutFrames } from '@/features/dashboard/editorLayout'
import {
  toggleEditorNodeVisibility,
  withEditorNodeVisibility,
} from './editorVisibility'

export function useEditorVisibility(
  editor: Pick<DashboardEditor, 'nodes'>,
  getManifest: GetModuleManifest,
  dashboardId: Readonly<Ref<string>>,
  reloadDocument: () => Promise<void>,
) {
  const hidden = ref<ReadonlySet<string>>(new Set())
  const nodes = computed(() =>
    withEditorNodeVisibility(editor.nodes.value, hidden.value),
  )
  const frames = computed(() => layoutFrames(nodes.value, getManifest).frames)

  function toggle(nodeId: string): void {
    hidden.value = toggleEditorNodeVisibility(hidden.value, nodeId)
  }

  function reload(): void {
    hidden.value = new Set()
    void reloadDocument()
  }

  watch(dashboardId, reload, { immediate: true })

  return { nodes, frames, toggle, reload }
}
