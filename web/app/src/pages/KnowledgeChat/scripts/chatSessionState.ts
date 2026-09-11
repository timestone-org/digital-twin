/** @fileoverview 已保存的对话清单与尚未完成首轮的会话。 */
import { computed, ref, shallowRef } from 'vue'
import type { KnowledgeChatSession } from '@dt/contracts'
import { useRacedFetch } from '@/composables/useRacedFetch'

export function createChatSessionState() {
  const sessions = shallowRef<KnowledgeChatSession[]>([])
  const selectedId = ref<string | null>(null)
  const pendingSession = shallowRef<KnowledgeChatSession | null>(null)
  const isCreating = ref(false)
  const creationRace = useRacedFetch()
  const current = computed(() =>
    pendingSession.value?.id === selectedId.value
      ? pendingSession.value
      : (sessions.value.find((one) => one.id === selectedId.value) ?? null),
  )
  const renameInPlace = (title: string, rowVersion: number): void => {
    const one = current.value
    if (one === null) return
    const updated = { ...one, title, row_version: rowVersion }
    if (pendingSession.value?.id === one.id) pendingSession.value = updated
    sessions.value = sessions.value.map((each) =>
      each.id === one.id ? updated : each,
    )
  }
  const publishPending = (): void => {
    const one = pendingSession.value
    if (one === null || one.id !== selectedId.value) return
    sessions.value = [
      one,
      ...sessions.value.filter((each) => each.id !== one.id),
    ]
    pendingSession.value = null
  }
  const cancelCreation = (): void => {
    creationRace.cancel()
    isCreating.value = false
  }
  return {
    sessions,
    selectedId,
    pendingSession,
    current,
    isCreating,
    creationRace,
    renameInPlace,
    publishPending,
    cancelCreation,
  }
}
