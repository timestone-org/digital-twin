/** @fileoverview 编辑视口的临时隔离与最近取景，不写入视点配置。 */
import { computed, ref, watch, type Ref } from 'vue'
import type { TwinSelection } from './types'
import type { TwinViewportHandle } from './twinViewportOps'
export function useTwinNavigation(
  viewport: Ref<TwinViewportHandle | null>,
  selection: () => TwinSelection,
  resetHidden: () => void,
) {
  const isolated = ref(false)
  const history = ref<ReturnType<TwinViewportHandle['snapshot']>[]>([])
  function focus(target: TwinSelection): void {
    const pose = viewport.value?.snapshot()
    if (pose !== undefined) history.value = [...history.value.slice(-19), pose]
    viewport.value?.focus(target)
  }
  function syncIsolation(): void {
    const target = selection()
    if (target.kind !== 'parts') isolated.value = false
    viewport.value?.isolatePart?.(
      isolated.value && 'id' in target ? target.id : null,
    )
  }
  watch(selection, syncIsolation)
  function toggleIsolation(): void {
    isolated.value = !isolated.value
    syncIsolation()
  }
  function reset(): void {
    isolated.value = false
    viewport.value?.isolatePart?.(null)
    resetHidden()
  }
  function back(): void {
    const pose = history.value.at(-1)
    if (pose === undefined) return
    history.value = history.value.slice(0, -1)
    viewport.value?.restoreView?.(pose)
  }
  return {
    isolated,
    canBack: computed(() => history.value.length > 0),
    focus,
    toggleIsolation,
    reset,
    back,
  }
}
