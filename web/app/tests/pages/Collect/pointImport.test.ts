/**
 * @fileoverview 批量导入的切批与逐批记账。
 *
 * ⚠ 后端一批 ≤200 且整批原子。切错批就是「每批都 422」，不按批记账就是
 * 「只说失败，用户重导一次撞一堆 409」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectPointItemInput } from '@dt/contracts'
import { COLLECT_POINT_BATCH_MAX } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as collect from '@/api/collect'
import {
  chunk,
  importPoints,
  importCsvPoints,
} from '@/pages/Collect/scripts/pointImport'

function item(code: string): CollectPointItemInput {
  return { code, name: code, address: `ns=2;s=${code}` }
}

function items(count: number): CollectPointItemInput[] {
  return Array.from({ length: count }, (_, index) => item(`p${index}`))
}

let createMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  createMock = vi.fn().mockImplementation((input: unknown) => {
    const batch = input as { items: CollectPointItemInput[] }
    return Promise.resolve({
      items: batch.items.map((one) => ({ ...one, id: one.code })),
      address_checks: batch.items.map((one) => ({
        address: one.address,
        status: 'passed',
        detail: null,
      })),
    })
  })
  vi.spyOn(collect, 'createPoints').mockImplementation(createMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('切批', () => {
  it('刚好一批时不切', () => {
    expect(chunk(items(COLLECT_POINT_BATCH_MAX))).toHaveLength(1)
  })

  it('多一条就切成两批', () => {
    expect(chunk(items(COLLECT_POINT_BATCH_MAX + 1))).toHaveLength(2)
  })

  it('空清单切出零批，不发一个空请求', () => {
    expect(chunk([])).toEqual([])
  })

  it('切完的总条数与切之前一致——丢一条不会有任何报错', () => {
    const batches = chunk(items(450))
    expect(batches.flat()).toHaveLength(450)
  })
})

describe('逐批提交', () => {
  it('CSV 分批累计新增、更新与未变更，并独立记录失败', async () => {
    const saved = vi
      .spyOn(collect, 'importPoints')
      .mockResolvedValueOnce({
        items: [],
        address_checks: [{ address: 'x', status: 'unverified', detail: null }],
        created_count: 10,
        updated_count: 180,
        unchanged_count: 10,
      })
      .mockRejectedValueOnce(new Error('该批校验失败'))
    const progress = vi.fn()
    const result = await importCsvPoints('s1', items(201), progress, true)
    expect(result).toMatchObject({
      created: 10,
      updated: 180,
      unchanged: 10,
      unverified: 1,
    })
    expect(result.failures[0]?.codes).toEqual(['p200'])
    expect(progress).toHaveBeenLastCalledWith({ done: 201, total: 201 })
    expect(saved.mock.calls[0]?.[0].is_skipping_existing).toBe(true)
    expect(saved.mock.calls[0]?.[1]).not.toBe(saved.mock.calls[1]?.[1])
  })

  it('空 CSV 不发导入请求', async () => {
    const saved = vi.spyOn(collect, 'importPoints')
    expect(await importCsvPoints('s1', [])).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 0,
    })
    expect(saved).not.toHaveBeenCalled()
  })

  it('每批各带一个幂等键——共用一个键会让第二批起静默丢失', async () => {
    await importPoints('s1', items(COLLECT_POINT_BATCH_MAX + 1))
    const keys = createMock.mock.calls.map((call) => call[1] as string)

    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it('全成功时记下建了多少条', async () => {
    const outcome = await importPoints('s1', items(3))
    expect(outcome.created).toBe(3)
    expect(outcome.failures).toEqual([])
  })

  it('进度按已提交条数走，含失败批', async () => {
    const seen: number[] = []
    await importPoints('s1', items(COLLECT_POINT_BATCH_MAX + 5), (progress) =>
      seen.push(progress.done),
    )
    expect(seen).toEqual([COLLECT_POINT_BATCH_MAX, COLLECT_POINT_BATCH_MAX + 5])
  })

  it('一批失败不带走其它批——前面几批是真的已经进库了', async () => {
    createMock.mockRejectedValueOnce(
      new BizError(41104, '编码已存在', 409, 't'),
    )
    const outcome = await importPoints('s1', items(COLLECT_POINT_BATCH_MAX + 1))

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.created).toBe(1)
  })

  it('失败里带上这一批的编码，用户才回得去文件里找', async () => {
    createMock.mockRejectedValueOnce(
      new BizError(41104, '编码已存在', 409, 't'),
    )
    const outcome = await importPoints('s1', items(2))

    expect(outcome.failures[0]?.codes).toEqual(['p0', 'p1'])
    expect(outcome.failures[0]?.batch).toBe(1)
  })

  it('没到现场确认过的寻址串单独计数，不混进「成功」里', async () => {
    createMock.mockResolvedValueOnce({
      items: [{ id: 'p0' }],
      address_checks: [
        { address: 'ns=2;s=p0', status: 'unverified', detail: '采集侧离线' },
      ],
    })
    const outcome = await importPoints('s1', items(1))

    expect(outcome.unverified).toBe(1)
  })

  it('空清单不发任何请求', async () => {
    const outcome = await importPoints('s1', [])

    expect(createMock).not.toHaveBeenCalled()
    expect(outcome.created).toBe(0)
  })
})
