/**
 * @fileoverview 工作台的两条取数路径：项目列表与当前项目的大屏列表。
 * 状态由 `useWorkbench` 持有，这里只负责把它填上。
 */
import type { ComputedRef, Ref } from 'vue'

import { listDashboards, listProjects } from '@/api/dashboard'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'

/** 一屏卡片够铺满 1920 宽的网格若干行；再多就靠搜索缩小范围。 */
const DASHBOARD_PAGE_SIZE = 60
const PROJECT_PAGE_SIZE = 100

export interface WorkbenchState {
  canView: ComputedRef<boolean>
  projects: Ref<ProjectSummary[]>
  dashboards: Ref<DashboardSummary[]>
  dashboardTotal: Ref<number>
  selectedProjectId: Ref<string | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
}

/**
 * 拉项目列表，并把选中态校正到一个真实存在的项目上。
 * ⚠ 没有 `dashboard:view` 就一个请求都不发：工作台是路由守卫的兜底目的地，
 * 自身不挂 `meta.permissions`，两个 403 只会把落地页糊成一片错误态。
 * @param state 工作台状态
 */
export async function loadProjects(state: WorkbenchState): Promise<void> {
  if (!state.canView.value) {
    state.projects.value = []
    return
  }
  try {
    const page = await listProjects({ size: PROJECT_PAGE_SIZE })
    state.projects.value = page.items
    state.error.value = null
    const selected = state.selectedProjectId.value
    if (!page.items.some((item) => item.id === selected)) {
      state.selectedProjectId.value = page.items[0]?.id ?? null
    }
  } catch (caught) {
    state.projects.value = []
    state.error.value = describeError(caught)
  }
}

/**
 * 拉当前项目下的大屏。
 * ⚠ 必须走竞态防护：切项目会连着发好几次，慢的那次后返回会盖掉快的那次，
 * 界面上显示的是上一个项目的屏，且没有任何报错。
 * @param state 工作台状态
 * @param raced 序号法竞态闸
 */
export async function loadDashboards(
  state: WorkbenchState,
  raced: RacedFetch,
): Promise<void> {
  const projectId = state.selectedProjectId.value
  if (!state.canView.value || projectId === null) {
    state.dashboards.value = []
    state.dashboardTotal.value = 0
    return
  }
  state.isLoading.value = true
  await raced.run(
    () => listDashboards({ projectId, size: DASHBOARD_PAGE_SIZE }),
    {
      ok: (page) => {
        state.dashboards.value = page.items
        state.dashboardTotal.value = page.total
        state.error.value = null
      },
      fail: (caught) => {
        state.dashboards.value = []
        state.dashboardTotal.value = 0
        state.error.value = describeError(caught)
      },
      settled: () => {
        state.isLoading.value = false
      },
    },
  )
}
