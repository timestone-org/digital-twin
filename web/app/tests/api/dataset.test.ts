/**
 * @fileoverview 锁住台账接口的 URL 形状、方法、载荷，以及**每一条都带 platform
 * 前缀**、每个写动作都带幂等键。
 *
 * ⚠ 漏给 `baseUrl` 不会有任何编译期报错：请求会打到 `/api/v1/auth/...`，边缘按
 * 前缀反代，拿回来的是一个 404 信封——现象是「这个页面没数据」，与真实原因隔得极远。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as dataset from '@/api/dataset'
import { PLATFORM_BASE_URL } from '@/config/app'

// ⚠ 两个入口都要打桩：取数走 requestData（必须有 data），
// 删除这类 204 的走 request。只桩一个的话另一个会真的去发 fetch。
let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, size: 200, total: 0 })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ROW = {
  tableId: 't1',
  rowId: 'r9',
  ts: '2026-02-02T03:04:00.000Z',
}

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('每一条都打 platform 前缀', () => {
  it.each([
    ['listDatasetTables', () => dataset.listDatasetTables()],
    [
      'createDatasetTable',
      () => dataset.createDatasetTable({ code: 'energy', name: '能耗台账' }),
    ],
    [
      'updateDatasetTable',
      () => dataset.updateDatasetTable('t1', { name: '改' }),
    ],
    ['deleteDatasetTable', () => dataset.deleteDatasetTable('t1')],
    ['listDatasetRecords', () => dataset.listDatasetRecords('t1')],
    [
      'createDatasetRecord',
      () => dataset.createDatasetRecord('t1', { values: {} }),
    ],
    ['deleteDatasetRecord', () => dataset.deleteDatasetRecord(ROW)],
    [
      'clearDatasetRecordOverrides',
      () => dataset.clearDatasetRecordOverrides(ROW, ['kwh']),
    ],
    [
      'clearDatasetOverridesInRange',
      () =>
        dataset.clearDatasetOverridesInRange('t1', { column_keys: ['kwh'] }),
    ],
    ['recomputeDatasetTable', () => dataset.recomputeDatasetTable('t1')],
  ])('%s', async (_name, run) => {
    await run()
    const [, options] = call()
    expect(options.baseUrl).toBe(PLATFORM_BASE_URL)
  })
})

describe('台账的读写', () => {
  it('列表带翻页参数，路径是资源复数', async () => {
    await dataset.listDatasetTables({ page: 1, size: 200 })
    const [path, options] = call()
    expect(path).toBe('/dataset-tables')
    expect(options.query).toEqual({ page: 1, size: 200 })
  })

  it('建表把编码一起提交，且带幂等键', async () => {
    await dataset.createDatasetTable(
      { code: 'energy', name: '能耗台账', collect_mode: 'aggregate' },
      'key-1',
    )
    const [path, options] = call()
    expect(path).toBe('/dataset-tables')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      code: 'energy',
      name: '能耗台账',
      collect_mode: 'aggregate',
    })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  it('改表走 PATCH，且**不带** code——它建后不可改', async () => {
    await dataset.updateDatasetTable('t1', { name: '新名', is_enabled: false })
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1')
    expect(options.method).toBe('PATCH')
    expect(options.body).not.toHaveProperty('code')
  })

  it('删除默认不 force：台账下还有行时后端该拦住这一次', async () => {
    await dataset.deleteDatasetTable('t1')
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1')
    expect(options.method).toBe('DELETE')
    expect(options.query).toEqual({ force: false })
  })

  it('确认后连历史一起删才带 force', async () => {
    await dataset.deleteDatasetTable('t1', true)
    expect(call()[1].query).toEqual({ force: true })
  })

  it('⚠ 两段式删除的两次调用各用各的幂等键', async () => {
    // 共用一个键的话，第二次（带 force 的那次）会被判成重放，
    // 直接拿回第一次那份 409——现象是「确认了也删不掉」，且不报错
    await dataset.deleteDatasetTable('t1')
    const first = call()[1].headers
    await dataset.deleteDatasetTable('t1', true)
    expect(call()[1].headers).not.toEqual(first)
  })

  it('删除走 request 而不是 requestData：这条是 204，没有 data', async () => {
    await dataset.deleteDatasetTable('t1')
    expect(client.request).toHaveBeenCalled()
  })
})

describe('数据行的读写', () => {
  it('⚠ 列表走游标而不是页码：时序集合按页码翻会静默重复与漏行', async () => {
    await dataset.listDatasetRecords('t1', { limit: 50, after: 'cursor-1' })
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1/records')
    expect(options.query).toEqual({ limit: 50, after: 'cursor-1' })
    expect(options.query).not.toHaveProperty('page')
  })

  it('录入走 POST，带幂等键——网络抖动引发的重试不该多出一行', async () => {
    await dataset.createDatasetRecord(
      't1',
      { ts: '2026-02-02T03:04:00.000Z', values: { inflow: 12 } },
      'key-1',
    )
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1/records')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  it('⚠ 编辑带 `?ts=` 分区键，且它是**改之前**那一刻', async () => {
    await dataset.updateDatasetRecord(ROW, {
      ts: '2026-03-03T03:04:00.000Z',
      values: {},
    })
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1/records/r9')
    expect(options.method).toBe('PATCH')
    expect(options.query).toEqual({ ts: '2026-02-02T03:04:00.000Z' })
  })

  it('⚠ 删行走 requestData：这条不是 204，回执里带着下游过期这件事', async () => {
    await dataset.deleteDatasetRecord(ROW)
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1/records/r9')
    expect(options.method).toBe('DELETE')
    expect(options.query).toEqual({ ts: '2026-02-02T03:04:00.000Z' })
    expect(client.requestData).toHaveBeenCalled()
  })
})

describe('人工修正', () => {
  it('撤销单格点名列标识，并带上分区键', async () => {
    await dataset.clearDatasetRecordOverrides(ROW, ['kwh'])
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1/records/r9/overrides')
    expect(options.method).toBe('DELETE')
    expect(options.body).toEqual({ keys: ['kwh'] })
    expect(options.query).toEqual({ ts: '2026-02-02T03:04:00.000Z' })
  })

  it('不点名就是整行全撤', async () => {
    await dataset.clearDatasetRecordOverrides(ROW)
    expect(call()[1].body).toEqual({ keys: null })
  })

  it('批量撤销是动作端点，故只能是 POST', async () => {
    await dataset.clearDatasetOverridesInRange('t1', {
      column_keys: ['kwh'],
      since: '2026-03-01T00:00:00.000Z',
    })
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1/overrides:clear')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      column_keys: ['kwh'],
      since: '2026-03-01T00:00:00.000Z',
      until: undefined,
    })
  })

  it('重算同样是动作端点，缺省即整表', async () => {
    await dataset.recomputeDatasetTable('t1')
    const [path, options] = call()
    expect(path).toBe('/dataset-tables/t1:recompute')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({})
  })
})
