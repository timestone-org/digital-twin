/**
 * @fileoverview 契约：加载防竞态（乱序返回时只有最后一次能写状态）、
 * 保存必带版本断言、版本冲突（41007）落成「你的版本旧了」而不是静默覆盖
 * （ADR-0012）；其余 409 走普通错误。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardPayload } from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import { BizError } from '@/api/client'
import {
  VERSION_CONFLICT_MESSAGE,
  useDashboardDoc,
} from '@/composables/useDashboardDoc'

function payload(id: string, rowVersion = 1): DashboardPayload {
  return {
    id,
    projectId: 'p1',
    name: `大屏 ${id}`,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '',
    updatedAt: '',
    nodes: [],
  }
}

/** 手动决定何时返回的假请求。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('加载', () => {
  it('取到的大屏写进状态', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload('d1'))
    const doc = useDashboardDoc()

    await doc.load('d1')

    expect(doc.dashboard.value?.id).toBe('d1')
    expect(doc.loading.value).toBe(false)
    expect(doc.error.value).toBeNull()
  })

  it('乱序返回时只有最后一次能写状态', async () => {
    const first = deferred<DashboardPayload>()
    const second = deferred<DashboardPayload>()
    vi.spyOn(dashboardApi, 'getDashboard')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const doc = useDashboardDoc()

    const slow = doc.load('d1')
    const quick = doc.load('d2')
    // 后发的先回，先发的后回——慢的那次不许覆盖新屏
    second.resolve(payload('d2'))
    first.resolve(payload('d1'))
    const [slowResult, quickResult] = await Promise.all([slow, quick])

    expect(doc.dashboard.value?.id).toBe('d2')
    expect(quickResult?.id).toBe('d2')
    expect(slowResult).toBeNull()
  })

  it('被放弃的那次失败了也不写错误', async () => {
    const first = deferred<DashboardPayload>()
    vi.spyOn(dashboardApi, 'getDashboard')
      .mockReturnValueOnce(
        first.promise.then(() => {
          throw new BizError(50000, '炸了', 500, 't')
        }),
      )
      .mockResolvedValueOnce(payload('d2'))
    const doc = useDashboardDoc()

    const slow = doc.load('d1')
    await doc.load('d2')
    first.resolve(payload('d1'))
    await slow

    expect(doc.error.value).toBeNull()
    expect(doc.dashboard.value?.id).toBe('d2')
  })

  it('失败时清掉大屏并给出一句能看的话', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockRejectedValue(
      new BizError(40400, '大屏不存在', 404, 't'),
    )
    const doc = useDashboardDoc()

    const loaded = await doc.load('d1')

    expect(loaded).toBeNull()
    expect(doc.dashboard.value).toBeNull()
    expect(doc.error.value).toBe('大屏不存在')
  })

  it('卸载之后返回的那次不再写状态', async () => {
    const first = deferred<DashboardPayload>()
    vi.spyOn(dashboardApi, 'getDashboard').mockReturnValue(first.promise)
    const doc = useDashboardDoc()

    const pending = doc.load('d1')
    doc.dispose()
    first.resolve(payload('d1'))
    await pending

    expect(doc.dashboard.value).toBeNull()
  })
})

describe('保存', () => {
  it('带上当前行版本作为断言', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload('d1', 7))
    const replace = vi
      .spyOn(dashboardApi, 'replaceLayout')
      .mockResolvedValue(payload('d1', 8))
    const doc = useDashboardDoc()
    await doc.load('d1')

    const saved = await doc.save({ expectedVersion: 7, nodes: [] })

    expect(replace).toHaveBeenCalledWith('d1', {
      expectedVersion: 7,
      nodes: [],
    })
    expect(saved?.rowVersion).toBe(8)
    expect(doc.dashboard.value?.rowVersion).toBe(8)
  })

  it('还没加载出大屏时不发请求', async () => {
    const replace = vi.spyOn(dashboardApi, 'replaceLayout')
    const doc = useDashboardDoc()

    expect(await doc.save({ expectedVersion: 1, nodes: [] })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('版本冲突按码识别，落成「你的版本旧了」而不是普通错误', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload('d1'))
    vi.spyOn(dashboardApi, 'replaceLayout').mockRejectedValue(
      new BizError(
        dashboardApi.DASHBOARD_VERSION_CONFLICT_CODE,
        '版本冲突',
        409,
        't',
      ),
    )
    const doc = useDashboardDoc()
    await doc.load('d1')

    const saved = await doc.save({ expectedVersion: 1, nodes: [] })

    expect(saved).toBeNull()
    expect(doc.conflict.value).toBe(VERSION_CONFLICT_MESSAGE)
    expect(doc.error.value).toBeNull()
  })

  it('HTTP 409 但错误码不是版本冲突时走普通错误，不劝人重新加载', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload('d1'))
    vi.spyOn(dashboardApi, 'replaceLayout').mockRejectedValue(
      new BizError(41005, '这张大屏里已经有同名的键', 409, 't'),
    )
    const doc = useDashboardDoc()
    await doc.load('d1')
    await doc.save({ expectedVersion: 1, nodes: [] })

    expect(doc.error.value).toBe('这张大屏里已经有同名的键')
    expect(doc.conflict.value).toBeNull()
  })

  it('其余失败落成普通错误，冲突标记保持干净', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload('d1'))
    vi.spyOn(dashboardApi, 'replaceLayout').mockRejectedValue(
      new BizError(40010, '节点树成环', 400, 't'),
    )
    const doc = useDashboardDoc()
    await doc.load('d1')
    await doc.save({ expectedVersion: 1, nodes: [] })

    expect(doc.error.value).toBe('节点树成环')
    expect(doc.conflict.value).toBeNull()
  })

  it('保存成功后清掉上一次的冲突提示', async () => {
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload('d1'))
    vi.spyOn(dashboardApi, 'replaceLayout')
      .mockRejectedValueOnce(new BizError(41007, '冲突', 409, 't'))
      .mockResolvedValueOnce(payload('d1', 2))
    const doc = useDashboardDoc()
    await doc.load('d1')
    await doc.save({ expectedVersion: 1, nodes: [] })
    await doc.save({ expectedVersion: 1, nodes: [] })

    expect(doc.conflict.value).toBeNull()
  })
})
