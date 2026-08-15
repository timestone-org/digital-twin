/**
 * @fileoverview 锁住素材面每个端点的路径与前缀。
 *
 * ⚠ 这一条是有代价才补上的：前缀漏了的话，客户端会拿缺省的 auth 前缀再拼一次，
 * 打出 `/api/v1/auth/api/v1/platform/assets`——这个地址在边缘**有人接**
 * （auth-server），于是回来的是一个 403 的 HTML 页，前端只说得出一句
 * 「服务端响应格式异常」，看着像后端坏了。整页的挂载测试挡不住它：那一层
 * 把 `@/api/assets` 整个替身掉了，URL 是怎么拼的根本没人跑过。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as assets from '@/api/assets'
import * as client from '@/api/client'

const PLATFORM_PREFIX = '/api/v1/platform'

let requestData: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>

const ASSET_WIRE = {
  id: 'a1',
  ref: 'asset:a1',
  kind: 'image',
  name: '图.png',
  content_type: 'image/png',
  size_bytes: 10,
  checksum: 'x',
  created_at: '2026-08-15T00:00:00.000Z',
  created_by: 'me',
}

beforeEach(() => {
  requestData = vi.fn().mockResolvedValue([])
  request = vi.fn().mockResolvedValue(null)
  vi.spyOn(client, 'requestData').mockImplementation(requestData)
  vi.spyOn(client, 'request').mockImplementation(request)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function lastCall(
  spy: ReturnType<typeof vi.fn>,
): [string, Record<string, unknown>] {
  const args = spy.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('素材面的前缀', () => {
  it('列素材打在 platform 前缀的 /assets 上', async () => {
    await assets.listAssets()
    const [path, options] = lastCall(requestData)

    expect(path).toBe('/assets')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
  })

  it('类型目录、详情、直传凭证、确认、删除也都在 platform 前缀上', async () => {
    requestData.mockResolvedValue([])
    await assets.listAssetKinds()
    expect(lastCall(requestData)[0]).toBe('/assets/kinds')

    requestData.mockResolvedValue(ASSET_WIRE)
    await assets.getAsset('a1')
    expect(lastCall(requestData)[0]).toBe('/assets/a1')

    requestData.mockResolvedValue({
      asset_id: 'a1',
      url: '/oss/',
      fields: {},
      expires_seconds: 300,
    })
    await assets.presignUpload(
      'image',
      new File(['x'], 'a.png', { type: 'image/png' }),
    )
    expect(lastCall(requestData)[0]).toBe('/assets:presign-upload')

    requestData.mockResolvedValue(ASSET_WIRE)
    await assets.finalizeUpload('a1', '图.png')
    expect(lastCall(requestData)[0]).toBe('/assets/a1:finalize')

    await assets.deleteAsset('a1')
    expect(lastCall(request)[0]).toBe('/assets/a1')

    // 一个都不许漏：漏掉的那个会静默打到 auth-server 上
    const bases = [...requestData.mock.calls, ...request.mock.calls].map(
      (args) => (args[1] as { baseUrl?: string } | undefined)?.baseUrl,
    )
    expect(bases.every((base) => base === PLATFORM_PREFIX)).toBe(true)
  })

  it('分页参数走 query，不自己拼查询串', async () => {
    await assets.listAssets('image', { limit: 50, offset: 100 })

    expect(lastCall(requestData)[0]).toBe('/assets')
    expect(lastCall(requestData)[1].query).toEqual({
      kind: 'image',
      limit: 50,
      offset: 100,
    })
  })

  it('不给类型与分页时不下发一串 undefined', async () => {
    await assets.listAssets()

    expect(lastCall(requestData)[1].query).toEqual({
      kind: undefined,
      limit: undefined,
      offset: undefined,
    })
  })

  it('删除用 DELETE，且走不要求 data 的那条', async () => {
    await assets.deleteAsset('a1')

    expect(lastCall(request)[1].method).toBe('DELETE')
  })
})
