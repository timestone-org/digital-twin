/** @fileoverview 工作台首载：项目列表拉失败时错误不许被随后的大屏请求抹掉。 */
import { createPinia, setActivePinia } from 'pinia'
import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSION_CODES } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import { writeLastProject } from '@/pages/Home/scripts/lastProject'
import { useWorkbench } from '@/pages/Home/scripts/useWorkbench'
import { useAuthStore } from '@/stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().user = {
    permissions: [PERMISSION_CODES.dashboardView],
  } as never
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useWorkbench.load', () => {
  it('项目列表失败就停在错误态，不再拉大屏把错误清掉', async () => {
    writeLastProject('p-1')
    vi.spyOn(dashboardApi, 'listProjects').mockRejectedValue(new Error('500'))
    const dashboards = vi
      .spyOn(dashboardApi, 'listDashboards')
      .mockResolvedValue({ items: [], page: 1, size: 60, total: 0 })
    const scope = effectScope()
    const workbench = scope.run(() => useWorkbench())
    if (!workbench) throw new Error('missing scope')
    await workbench.load()
    expect(workbench.error.value).not.toBeNull()
    expect(workbench.isLoading.value).toBe(false)
    expect(dashboards).not.toHaveBeenCalled()
    scope.stop()
  })
})
