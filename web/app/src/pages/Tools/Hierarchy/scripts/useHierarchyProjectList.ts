/** @fileoverview 层级图项目列表、搜索与分页。 */
import { listProjects } from '@/api/hierarchy'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { HierarchyProject, HierarchySummary } from '@dt/contracts'
import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'

/** 读取分页列表，并在当前项目保存后更新摘要。 */
export function useHierarchyProjectList(
  savedProject: Readonly<Ref<HierarchyProject | null>>,
  fail: (error: unknown) => void,
  clearError: () => void,
) {
  const list = useProjectPage(fail, clearError)
  watch(savedProject, (project) => {
    if (project)
      list.items.value = list.items.value.map((item) =>
        item.id === project.id ? project : item,
      )
  })
  async function goToPage(page: number): Promise<void> {
    list.page.value = page
    await list.refresh()
  }
  return {
    ...list,
    goToPage,
    search: () => goToPage(1),
    setQuery: (query: string) => {
      list.query.value = query
    },
  }
}

function useProjectPage(
  fail: (error: unknown) => void,
  clearError: () => void,
) {
  const items = shallowRef<HierarchySummary[]>([])
  const page = ref(1)
  const total = ref(0)
  const query = ref('')
  const listLoading = ref(false)
  const request = useRacedFetch()
  let alive = true

  onBeforeUnmount(() => {
    alive = false
    request.cancel()
  })

  async function refresh(): Promise<void> {
    if (!alive) return
    listLoading.value = true
    await request.run(
      (signal) =>
        listProjects({ page: page.value, size: 20, q: query.value }, signal),
      {
        ok: (result) => {
          items.value = result.items
          total.value = result.total
          clearError()
        },
        fail,
        settled: () => {
          if (alive) listLoading.value = false
        },
      },
    )
  }

  return { items, page, total, query, listLoading, refresh }
}
