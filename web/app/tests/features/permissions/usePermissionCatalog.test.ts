/**
 * @fileoverview 权限目录取数的契约：全应用取一次、并发合并成一次、失败可重试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authApi from '@/api/auth'
import {
  __resetPermissionCatalog,
  usePermissionCatalog,
} from '@/features/permissions/usePermissionCatalog'

const CATALOG = {
  items: [],
  groups: [{ code: 'user', label: '用户与角色', items: [] }],
}

beforeEach(() => {
  __resetPermissionCatalog()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePermissionCatalog', () => {
  it('第一次 ensure 会取数', async () => {
    const fetchIt = vi
      .spyOn(authApi, 'fetchPermissionCatalog')
      .mockResolvedValue(CATALOG)
    const catalog = usePermissionCatalog()
    await catalog.ensure()
    expect(fetchIt).toHaveBeenCalledTimes(1)
    expect(catalog.groups.value).toHaveLength(1)
  })

  it('取过之后不再取——目录是种子驱动的静态数据', async () => {
    const fetchIt = vi
      .spyOn(authApi, 'fetchPermissionCatalog')
      .mockResolvedValue(CATALOG)
    await usePermissionCatalog().ensure()
    await usePermissionCatalog().ensure()
    expect(fetchIt).toHaveBeenCalledTimes(1)
  })

  it('并发的三次 ensure 合并成一次请求', async () => {
    const fetchIt = vi
      .spyOn(authApi, 'fetchPermissionCatalog')
      .mockResolvedValue(CATALOG)
    const catalog = usePermissionCatalog()
    await Promise.all([catalog.ensure(), catalog.ensure(), catalog.ensure()])
    expect(fetchIt).toHaveBeenCalledTimes(1)
  })

  it('失败时记下原因，且下次 ensure 会重试', async () => {
    const { TransportError } = await import('@/api/client')
    const fetchIt = vi
      .spyOn(authApi, 'fetchPermissionCatalog')
      .mockRejectedValueOnce(new TransportError(0, '网络不可达'))
      .mockResolvedValueOnce(CATALOG)
    const catalog = usePermissionCatalog()
    await catalog.ensure()
    expect(catalog.error.value).toBe('网络不可达')
    await catalog.ensure()
    expect(fetchIt).toHaveBeenCalledTimes(2)
    expect(catalog.error.value).toBeNull()
  })
})
