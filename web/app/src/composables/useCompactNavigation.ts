/** @fileoverview 按可用视口切换管理端导航形态，卸载时移除媒体查询监听。 */
import { onBeforeUnmount, ref, readonly } from 'vue'
import type { Ref } from 'vue'

export function useCompactNavigation(): Readonly<Ref<boolean>> {
  const query = window.matchMedia('(max-width: 1023px), (max-height: 599px)')
  const isCompact = ref(query.matches)
  function update(): void {
    isCompact.value = query.matches
  }
  query.addEventListener('change', update)
  onBeforeUnmount(() => query.removeEventListener('change', update))
  return readonly(isCompact)
}
