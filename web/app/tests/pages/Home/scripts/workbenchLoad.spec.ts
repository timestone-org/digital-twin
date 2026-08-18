/**
 * @fileoverview 两条取数路径的边界：没权限不发请求、失败要留下能读的错误、
 * 以及切项目时慢的那次不许盖掉快的那次。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { Page } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  loadDashboards,
  loadProjects,
  type WorkbenchState,
} from '@/pages/Home/scripts/workbenchLoad'

function stateOf(canView: boolean, selected: string | null): WorkbenchState {
  return {
    canView: computed(() => canView),
    projects: ref<ProjectSummary[]>([]),
    dashboards: ref<DashboardSummary[]>([]),
    dashboardTotal: ref(0),
    selectedProjectId: ref(selected),
    isLoading: ref(false),
    error: ref<string | null>(null),
  }
}

function dashboard(id: string): DashboardSummary {
  return {
    id,
    projectId: 'p-1',
    name: id,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function pageOf(
  items: DashboardSummary[],
  total = items.length,
): Page<DashboardSummary> {
  return { items, page: 1, size: 60, total }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('拉项目', () => {
  it('没有查看权限时一个请求都不发', async () => {
    const list = vi.spyOn(dashboardApi, 'listProjects')
    await loadProjects(stateOf(false, null))
    expect(list).not.toHaveBeenCalled()
  })

  it('失败时清空列表并留下能读的错误', async () => {
    vi.spyOn(dashboardApi, 'listProjects').mockRejectedValue(
      new Error('后端挂了'),
    )
    const state = stateOf(true, 'p-1')
    await loadProjects(state)
    expect(state.projects.value).toEqual([])
    expect(state.error.value).not.toBeNull()
  })
})

describe('拉当前项目的大屏', () => {
  it('没选项目时清空列表且不发请求', async () => {
    const list = vi.spyOn(dashboardApi, 'listDashboards')
    const state = stateOf(true, null)
    state.dashboards.value = [dashboard('d-old')]
    state.dashboardTotal.value = 1
    await loadDashboards(state, useRacedFetch())
    expect(list).not.toHaveBeenCalled()
    expect(state.dashboards.value).toEqual([])
    expect(state.dashboardTotal.value).toBe(0)
  })

  it('失败时清空列表、归零总数并留下错误', async () => {
    vi.spyOn(dashboardApi, 'listDashboards').mockRejectedValue(
      new Error('超时'),
    )
    const state = stateOf(true, 'p-1')
    await loadDashboards(state, useRacedFetch())
    expect(state.dashboards.value).toEqual([])
    expect(state.dashboardTotal.value).toBe(0)
    expect(state.error.value).not.toBeNull()
    expect(state.isLoading.value).toBe(false)
  })

  it('总数原样带出来——列表被截断时页面要靠它说话', async () => {
    vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(
      pageOf([dashboard('d-1')], 200),
    )
    const state = stateOf(true, 'p-1')
    await loadDashboards(state, useRacedFetch())
    expect(state.dashboardTotal.value).toBe(200)
  })

  it('慢的那次后返回时既不写列表也不关掉加载态', async () => {
    const settlers: Array<(page: Page<DashboardSummary>) => void> = []
    vi.spyOn(dashboardApi, 'listDashboards').mockImplementation(
      () =>
        new Promise<Page<DashboardSummary>>((resolve) => {
          settlers.push(resolve)
        }),
    )
    const state = stateOf(true, 'p-1')
    const raced = useRacedFetch()
    const first = loadDashboards(state, raced)
    const second = loadDashboards(state, raced)

    settlers[1]?.(pageOf([dashboard('d-new')]))
    await second
    settlers[0]?.(pageOf([dashboard('d-stale')]))
    await first

    expect(state.dashboards.value.map((item) => item.id)).toEqual(['d-new'])
  })
})
