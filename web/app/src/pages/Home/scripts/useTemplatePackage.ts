/** @fileoverview 读取当前模板的整包，供创建前确认联动。 */
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { DashboardTemplateDetail } from '@dt/contracts'
import { getDashboardTemplate } from '@/api/dashboardTemplates'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 模板切换、取消或卸载后作废在途读取。 */
export function useTemplatePackage(selectedId: () => string) {
  const detail = shallowRef<DashboardTemplateDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const request = useRacedFetch()
  onScopeDispose(request.cancel)
  const payload = computed(() =>
    detail.value?.id === selectedId() ? detail.value.payload : null,
  )
  async function load(): Promise<void> {
    const id = selectedId()
    detail.value = null
    error.value = null
    loading.value = id !== ''
    if (!loading.value) {
      request.cancel()
      return
    }
    await request.run((signal) => getDashboardTemplate(id, signal), {
      ok: (result) => {
        detail.value = result
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        loading.value = false
      },
    })
  }
  watch(
    selectedId,
    () => {
      void load()
    },
    { immediate: true, flush: 'post' },
  )
  return { payload, loading, error, load }
}
