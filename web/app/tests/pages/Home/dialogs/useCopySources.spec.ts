/**
 * @fileoverview 契约：复制来源跨项目拉一次全量；超过一页时说出来而不是静默截断；
 * 拉不到就把候选留空，由调用方退回页面已有的那份。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '@dt/ui'
import type { Page } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import type { DashboardSummary } from '@/api/dashboardWire'
import { useCopySources } from '@/pages/Home/components/useCopySources'

function dashboard(id: string, projectId: string): DashboardSummary {
  return {
    id,
    projectId,
    name: `屏 ${id}`,
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

function page(
  items: DashboardSummary[],
  total = items.length,
): Page<DashboardSummary> {
  return { items, total, page: 1, size: 200 }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('取候选', () => {
  it('不带项目过滤地拉，拿到的是跨项目那份', async () => {
    const spy = vi
      .spyOn(dashboardApi, 'listDashboards')
      .mockResolvedValue(page([dashboard('d1', 'p1'), dashboard('d2', 'p2')]))
    const sources = useCopySources()

    await sources.load()

    expect(spy).toHaveBeenCalledWith({ size: 200 })
    expect(sources.items.value.map((item) => item.projectId)).toEqual([
      'p1',
      'p2',
    ])
  })

  it('拉不到时候选留空，让调用方退回页面已有的那份', async () => {
    vi.spyOn(dashboardApi, 'listDashboards').mockRejectedValue(
      new Error('炸了'),
    )
    const sources = useCopySources()

    await sources.load()

    expect(sources.items.value).toEqual([])
  })

  it('超过一页时把「只列得下前 200 张」说出来，不静默截断', async () => {
    vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(
      page([dashboard('d1', 'p1')], 500),
    )
    const toast = useToast()
    toast.clear()

    await useCopySources().load()

    expect(
      toast.toasts.value.some((item) =>
        item.message.includes('只列得下前 200'),
      ),
    ).toBe(true)
  })

  it('没超一页时不多嘴', async () => {
    vi.spyOn(dashboardApi, 'listDashboards').mockResolvedValue(
      page([dashboard('d1', 'p1')]),
    )
    const toast = useToast()
    toast.clear()

    await useCopySources().load()

    expect(toast.toasts.value).toHaveLength(0)
  })
})
