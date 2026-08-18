/**
 * @fileoverview 工作台的状态：项目列表、当前项目的大屏列表、搜索过滤与选中态。
 * 取数本身在 `../workbenchLoad`。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'

import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useAuthStore } from '@/stores/auth'
import { readLastProject, writeLastProject } from './lastProject'
import {
  loadDashboards,
  loadProjects,
  type WorkbenchState,
} from './workbenchLoad'

export interface Workbench extends WorkbenchState {
  selectedProject: ComputedRef<ProjectSummary | null>
  search: Ref<string>
  visibleDashboards: ComputedRef<DashboardSummary[]>
  load: () => Promise<void>
  reloadProjects: () => Promise<void>
  reloadDashboards: () => Promise<void>
  selectProject: (projectId: string) => void
}

/**
 * 按名字过滤，空关键词原样返回。
 * @param items 当前项目下的大屏
 * @param keyword 搜索框里的原始输入
 */
function filterByName(
  items: readonly DashboardSummary[],
  keyword: string,
): DashboardSummary[] {
  const needle = keyword.trim().toLowerCase()
  return needle === ''
    ? [...items]
    : items.filter((item) => item.name.toLowerCase().includes(needle))
}

export function useWorkbench(): Workbench {
  const auth = useAuthStore()
  const raced = useRacedFetch()
  const search = ref('')
  const state: WorkbenchState = {
    canView: computed(() => auth.can([PERMISSION_CODES.dashboardView])),
    projects: ref<ProjectSummary[]>([]),
    dashboards: ref<DashboardSummary[]>([]),
    dashboardTotal: ref(0),
    selectedProjectId: ref(readLastProject()),
    isLoading: ref(false),
    error: ref<string | null>(null),
  }

  const selectedProject = computed(
    () =>
      state.projects.value.find(
        (item) => item.id === state.selectedProjectId.value,
      ) ?? null,
  )

  const visibleDashboards = computed(() =>
    filterByName(state.dashboards.value, search.value),
  )

  // 选中态有多处赋值（点选、加载后校正、删项目后回落），写盘挂在这里一处兜住
  watch(state.selectedProjectId, writeLastProject)

  const reloadProjects = (): Promise<void> => loadProjects(state)
  const reloadDashboards = (): Promise<void> => loadDashboards(state, raced)

  async function load(): Promise<void> {
    state.isLoading.value = true
    await reloadProjects()
    await reloadDashboards()
    state.isLoading.value = false
  }

  function selectProject(projectId: string): void {
    if (projectId === state.selectedProjectId.value) return
    state.selectedProjectId.value = projectId
    search.value = ''
    void reloadDashboards()
  }

  return {
    ...state,
    search,
    selectedProject,
    visibleDashboards,
    load,
    reloadProjects,
    reloadDashboards,
    selectProject,
  }
}
