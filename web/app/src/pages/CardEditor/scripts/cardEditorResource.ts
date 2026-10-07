/** @fileoverview 卡片文档的加载归属与保存前资源校验。 */
import type { DashboardPayload } from '@dt/contracts'
import type { Ref } from 'vue'

import type { RacedFetch } from '@/composables/useRacedFetch'
import type { DocState } from '@/features/dashboard/docIo'

export interface CardPageState {
  doc: DocState
  missing: Ref<boolean>
  isDirty: Ref<boolean>
  raced: RacedFetch
  dashboardId: () => string
  nodeId: () => string
  loadedNodeId: string | null
}

/** 跨资源先隔离旧草稿；同资源重载仍可保留已确认的草稿。 */
export function prepareCardLoad(
  state: CardPageState,
  dashboardId: string,
): string {
  const forNode = state.nodeId()
  if (
    state.doc.dashboard.value?.id !== dashboardId ||
    state.loadedNodeId !== forNode
  ) {
    state.doc.dashboard.value = null
    state.isDirty.value = false
    state.loadedNodeId = null
  }
  return forNode
}

/** 只返回当前路由已成功加载且可保存的文档。 */
export function cardSaveSnapshot(
  state: CardPageState,
): DashboardPayload | null {
  const current = state.doc.dashboard.value
  if (
    current === null ||
    state.doc.saving.value ||
    state.doc.loading.value ||
    state.doc.isDisposed === true ||
    current.id !== state.dashboardId() ||
    state.loadedNodeId !== state.nodeId() ||
    state.missing.value
  )
    return null
  return current
}
