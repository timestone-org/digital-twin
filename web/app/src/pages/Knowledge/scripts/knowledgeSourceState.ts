/** @fileoverview 来源列表与管理操作共享的请求状态。 */
import { ref, shallowRef } from 'vue'
import { useConfirm } from '@dt/ui'
import type { KnowledgeSource } from '@/api/knowledge'
import { useRacedFetch } from '@/composables/useRacedFetch'

export function createSourceState(baseId: () => string, isOpen: () => boolean) {
  return {
    baseId,
    isOpen,
    confirm: useConfirm(),
    race: useRacedFetch(),
    sources: shallowRef<KnowledgeSource[]>([]),
    error: ref(''),
    result: ref(''),
    isLoading: ref(false),
    isBusy: ref(false),
    isDisposed: false,
  }
}
export type SourceState = ReturnType<typeof createSourceState>

export function isCurrent(state: SourceState, wanted: string): boolean {
  return !state.isDisposed && state.baseId() === wanted && state.isOpen()
}

export function canWrite(state: SourceState): boolean {
  return (
    state.baseId() !== '' &&
    !state.isDisposed &&
    state.isOpen() &&
    !state.isBusy.value &&
    !state.isLoading.value
  )
}
