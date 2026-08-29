/**
 * @fileoverview 契约：卡片样式库的 URL 形状、入参线形、幂等键，以及出参窄化。
 *
 * ⚠ 外壳段读侧要窄化：库里那袋是自由 JSON，可能带着一个已经从 `CHROME_KEYS`
 * 里删掉的旧键——原样透传的话它会跟着「另存为」一路存回去，永远清不掉，
 * 而渲染侧早就不认它了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as styles from '@/api/cardStyles'
import { toCardChrome, toCardStyle } from '@/api/cardStylesWire'
import * as client from '@/api/client'

const PLATFORM_PREFIX = '/api/v1/platform'

const WIRE = {
  id: 's1',
  name: '蓝调科技卡',
  description: '呼吸描边',
  module_type: 'info-card',
  chrome_json: { radius: 4, borderStyle: 'breathe' },
  config_json: { align: 'center' },
  thumbnail: null,
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
}

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi
    .fn()
    .mockResolvedValue({ items: [WIRE], page: 1, size: 20, total: 1, ...WIRE })
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
  it('字段名转成 camelCase，两袋原样带过来', () => {
    expect(toCardStyle(WIRE)).toEqual({
      id: 's1',
      name: '蓝调科技卡',
      description: '呼吸描边',
      moduleType: 'info-card',
      chrome: { radius: 4, borderStyle: 'breathe' },
      config: { align: 'center' },
      thumbnail: null,
      createdAt: '2026-08-29T00:00:00Z',
      updatedAt: '2026-08-29T00:00:00Z',
    })
  })

  // ⚠ 不窄化的话，废弃键会跟着「另存为」一路存回去，而渲染侧早就不认它了
  it('外壳里没登记过的键一律丢掉', () => {
    expect(toCardChrome({ radius: 4, 出土文物: 1 })).toEqual({ radius: 4 })
  })

  it('外壳不是对象时给空袋子，不抛也不留 null', () => {
    expect(toCardChrome(null)).toEqual({})
    expect(toCardChrome([1, 2])).toEqual({})
  })

  it('内芯不窄化：观感键是逐模块的，这一层不认识任何一个模块', () => {
    expect(toCardStyle({ ...WIRE, config_json: { 谁知道: 1 } }).config).toEqual(
      {
        谁知道: 1,
      },
    )
  })
})

describe('列表', () => {
  it('打在 platform 前缀的 `/card-styles` 上，带模块类型与分页', async () => {
    await styles.listCardStyles({ moduleType: 'info-card', page: 2, size: 50 })
    const [path, options] = call()

    expect(path).toBe('/card-styles')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.query).toEqual({
      module_type: 'info-card',
      page: 2,
      size: 50,
    })
  })

  it('出参逐项转成载荷', async () => {
    const page = await styles.listCardStyles()

    expect(page.items[0]).toMatchObject({ id: 's1', moduleType: 'info-card' })
  })

  it('详情打在那一条上', async () => {
    const one = await styles.getCardStyle('s1')
    const [path] = call()

    expect(path).toBe('/card-styles/s1')
    expect(one.id).toBe('s1')
  })
})

describe('写', () => {
  it('新建走 POST 并带幂等键——网络抖动重试不该存出第二条', async () => {
    await styles.createCardStyle(
      { name: '蓝调', chrome: { radius: 4 }, moduleType: 'info-card' },
      'key-1',
    )
    const [path, options] = call()

    expect(path).toBe('/card-styles')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  // ⚠ 逐字段写而不是 `as`：多一个键服务端会 400，少一个键会静默走缺省
  it('入参逐字段转成 snake_case，没给的落成 null 或空对象', async () => {
    await styles.createCardStyle({ name: '蓝调', chrome: {} }, 'key-2')
    const [, options] = call()

    expect(options.body).toEqual({
      name: '蓝调',
      description: null,
      module_type: null,
      chrome_json: {},
      config_json: {},
      thumbnail: null,
    })
  })

  it('改走 PATCH 到那一条上', async () => {
    await styles.updateCardStyle('s1', { name: '蓝调', chrome: {} })
    const [path, options] = call()

    expect(path).toBe('/card-styles/s1')
    expect(options.method).toBe('PATCH')
  })

  it('删走 DELETE 到那一条上', async () => {
    await styles.deleteCardStyle('s1')
    const [path, options] = call()

    expect(path).toBe('/card-styles/s1')
    expect(options.method).toBe('DELETE')
  })
})
