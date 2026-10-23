/** @fileoverview 最新台账读取的合并、分页、空值与故障隔离契约。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import { readDatasetLatest } from '@/api/datasetLatest'

const TABLE = {
  id: 't1',
  code: 'nyyh',
  collect_mode: 'aggregate',
  collect_interval_ms: 300000,
}
const TS = '2026-10-23T03:00:00Z'
let requestMock: ReturnType<typeof vi.fn>
const controller = new AbortController()

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValueOnce({
    items: [TABLE],
    page: 1,
    size: 200,
    total: 1,
  })
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => vi.restoreAllMocks())

describe('最新值的业务口径', () => {
  it('同表多列只取一次 latest，原值与公式值合并，零与假不丢失', async () => {
    requestMock.mockResolvedValueOnce({
      ts: TS,
      values: { water: 0, state: false },
      computed: { heat: 5.8 },
    })
    const result = await readDatasetLatest(
      ['ds:nyyh:water', 'ds:nyyh:state', 'ds:nyyh:heat'],
      controller.signal,
    )
    expect([...result.values()].map((one) => one.slot)).toMatchObject([
      { state: 'ok', value: 0 },
      { state: 'ok', value: false },
      { state: 'ok', value: 5.8 },
    ])
    expect(result.get('ds:nyyh:heat')?.staleAtMs).toBe(Date.parse(TS) + 660000)
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it('空表显示暂无数据；列不存在显示明确错误', async () => {
    requestMock.mockResolvedValueOnce({ ts: null, values: {}, computed: {} })
    const empty = await readDatasetLatest(['ds:nyyh:heat'], controller.signal)
    expect(empty.get('ds:nyyh:heat')?.slot).toEqual({
      state: 'ok',
      value: null,
    })
    requestMock.mockResolvedValueOnce({
      items: [TABLE],
      page: 1,
      size: 200,
      total: 1,
    })
    requestMock.mockResolvedValueOnce({ ts: TS, values: {}, computed: {} })
    const absent = await readDatasetLatest(['ds:nyyh:heat'], controller.signal)
    expect(absent.get('ds:nyyh:heat')?.slot).toEqual({
      state: 'error',
      message: '台账最新行缺少列：heat',
    })
  })

  it('翻页找到第二页台账，并保留精确数字字符串', async () => {
    requestMock
      .mockReset()
      .mockResolvedValueOnce({ items: [], page: 1, size: 1, total: 2 })
    requestMock.mockResolvedValueOnce({
      items: [TABLE],
      page: 2,
      size: 1,
      total: 2,
    })
    requestMock.mockResolvedValueOnce({
      ts: TS,
      values: { heat: '1234567890.123456789' },
      computed: {},
    })
    await expect(
      readDatasetLatest(['ds:nyyh:heat'], controller.signal),
    ).rejects.toThrow('分页未返回完整结果')
    requestMock.mockReset().mockResolvedValueOnce({
      items: [{ ...TABLE, code: 'other' }],
      page: 1,
      size: 1,
      total: 2,
    })
    requestMock.mockResolvedValueOnce({
      items: [TABLE],
      page: 2,
      size: 1,
      total: 2,
    })
    requestMock.mockResolvedValueOnce({
      ts: TS,
      values: { heat: '1234567890.123456789' },
      computed: {},
    })
    const result = await readDatasetLatest(['ds:nyyh:heat'], controller.signal)
    expect(result.get('ds:nyyh:heat')?.slot).toMatchObject({
      state: 'ok',
      value: '1234567890.123456789',
    })
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/dataset-tables',
      expect.objectContaining({ query: { page: 2, size: 200 } }),
    )
  })

  it('一张台账请求失败不会拖掉其它表', async () => {
    requestMock
      .mockReset()
      .mockResolvedValueOnce({
        items: [TABLE, { ...TABLE, id: 't2', code: 'other' }],
        page: 1,
        size: 200,
        total: 2,
      })
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ ts: TS, values: { heat: 8 }, computed: {} })
    const result = await readDatasetLatest(
      ['ds:nyyh:heat', 'ds:other:heat'],
      controller.signal,
    )
    expect(result.get('ds:nyyh:heat')?.slot.state).toBe('error')
    expect(result.get('ds:other:heat')?.slot).toMatchObject({
      state: 'ok',
      value: 8,
    })
  })

  it('不存在的表和畸形身份都明确报错', async () => {
    const result = await readDatasetLatest(
      ['ds:missing:heat', 'broken'],
      controller.signal,
    )
    expect(result.get('ds:missing:heat')?.slot).toEqual({
      state: 'error',
      message: '台账不存在：missing',
    })
    expect(result.get('broken')?.slot.state).toBe('error')
    expect(requestMock).toHaveBeenCalledTimes(1)
  })
})
