/**
 * @fileoverview 契约：缩略图读写的 URL 与「没存过」这条路径。
 *
 * ⚠ 只有 404 收成 null：403 与 5xx 必须继续往上抛，否则「没权限看」会显示成
 * 「还没截过图」，用户永远等不到那张图也看不到原因。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as thumbnails from '@/api/dashboardThumbnail'
import { toThumbnail } from '@/api/dashboardThumbnailWire'

const PLATFORM_PREFIX = '/api/v1/platform'
const DATA_URL = 'data:image/jpeg;base64,AAAA'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    dashboard_id: 'db1',
    data: DATA_URL,
    updated_at: '2026-08-14T00:00:00Z',
  })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('线形映射', () => {
  it('字段名转成 camelCase', () => {
    expect(
      toThumbnail({
        dashboard_id: 'db1',
        data: DATA_URL,
        updated_at: '2026-08-14T00:00:00Z',
      }),
    ).toEqual({
      dashboardId: 'db1',
      data: DATA_URL,
      updatedAt: '2026-08-14T00:00:00Z',
    })
  })
})

describe('读', () => {
  it('打在 platform 前缀的子资源上', async () => {
    const found = await thumbnails.getDashboardThumbnail('db1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1/thumbnail')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(found?.data).toBe(DATA_URL)
  })

  it('没存过时给 null，调用方据此显示占位图', async () => {
    requestMock.mockRejectedValueOnce(
      new client.BizError(41017, '没有缩略图', 404, 't1'),
    )

    expect(await thumbnails.getDashboardThumbnail('db1')).toBeNull()
  })

  it('没权限与服务端错继续往上抛，不伪装成「还没截过图」', async () => {
    requestMock.mockRejectedValueOnce(
      new client.BizError(40106, '没有权限', 403, 't1'),
    )
    await expect(thumbnails.getDashboardThumbnail('db1')).rejects.toThrow(
      client.BizError,
    )

    requestMock.mockRejectedValueOnce(new client.TransportError(0, '超时'))
    await expect(thumbnails.getDashboardThumbnail('db1')).rejects.toThrow(
      client.TransportError,
    )
  })
})

describe('写', () => {
  it('整份替换走 PUT，请求体里是 data URL', async () => {
    const saved = await thumbnails.saveDashboardThumbnail('db1', DATA_URL)
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1/thumbnail')
    expect(options.method).toBe('PUT')
    expect(options.body).toEqual({ data: DATA_URL })
    expect(saved.dashboardId).toBe('db1')
  })

  it('整份替换本就幂等，不额外带幂等键', async () => {
    await thumbnails.saveDashboardThumbnail('db1', DATA_URL)

    expect('headers' in call()[1]).toBe(false)
  })
})

describe('错误码', () => {
  it('没截过与图太大各有自己的码，按码分支不按文案', () => {
    expect(thumbnails.THUMBNAIL_NOT_FOUND_CODE).toBe(41017)
    expect(thumbnails.THUMBNAIL_TOO_LARGE_CODE).toBe(41018)
  })
})
