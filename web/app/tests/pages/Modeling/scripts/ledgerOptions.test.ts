/**
 * @fileoverview 台账清单：翻完所有页、没权限一趟不发、失败与没权限分开说、
 * 连点重试时只有最后一次能写状态。
 */
import type { DatasetTableSummary, Page } from '@dt/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as dataset from '@/api/dataset'
import { useLedgerOptions } from '@/pages/Modeling/Canvas/scripts/useLedgerOptions'

const STAMP = '2026-01-01T00:00:00.000Z'

function table(code: string): DatasetTableSummary {
  return {
    id: `id-${code}`,
    code,
    name: `台账 ${code}`,
    description: null,
    collect_mode: 'manual',
    collect_interval_ms: 86_400_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 1,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function pageOf(
  items: DatasetTableSummary[],
  over: Partial<Page<DatasetTableSummary>> = {},
): Page<DatasetTableSummary> {
  return { items, page: 1, size: 200, total: items.length, ...over }
}

/** 一个能从外面兑现的承诺，用来摆布两次请求的返回顺序。 */
function deferred<TValue>() {
  let resolve: (value: TValue) => void = () => undefined
  const promise = new Promise<TValue>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('台账清单', () => {
  it('超过一页时接着翻，直到拿全', async () => {
    const listTables = vi
      .spyOn(dataset, 'listDatasetTables')
      .mockResolvedValueOnce(
        pageOf([table('a'), table('b')], { size: 2, total: 3 }),
      )
      .mockResolvedValueOnce(
        pageOf([table('c')], { page: 2, size: 2, total: 3 }),
      )
    const ledger = useLedgerOptions({ canView: () => true })

    await ledger.loadTables()

    expect(ledger.tables.value.map((item) => item.code)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(listTables.mock.calls.map(([query]) => query?.page)).toEqual([1, 2])
    expect(ledger.state.value).toBe('ready')
  })

  it('没有 dataset:view 时一趟都不发，状态是「没权限」', async () => {
    const listTables = vi.spyOn(dataset, 'listDatasetTables')
    const ledger = useLedgerOptions({ canView: () => false })

    await ledger.loadTables()

    expect(listTables).not.toHaveBeenCalled()
    expect(ledger.state.value).toBe('denied')
    expect(ledger.note.value).toContain('dataset:view')
  })

  it('拉取失败是「失败」不是「没权限」，重试成功后转成「就绪」', async () => {
    const listTables = vi
      .spyOn(dataset, 'listDatasetTables')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(pageOf([table('a')]))
    const ledger = useLedgerOptions({ canView: () => true })

    await ledger.loadTables()
    expect(ledger.state.value).toBe('failed')
    expect(ledger.note.value).not.toContain('dataset:view')

    await ledger.loadTables()

    expect(listTables).toHaveBeenCalledTimes(2)
    expect(ledger.state.value).toBe('ready')
    expect(ledger.note.value).toBe('')
  })

  it('一张台账都没有时说「还没建过」', async () => {
    vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue(pageOf([]))
    const ledger = useLedgerOptions({ canView: () => true })

    await ledger.loadTables()

    expect(ledger.state.value).toBe('empty')
    expect(ledger.note.value).toContain('还没有建过')
  })

  // ⚠ 连点两次重试，慢的那次后返回不许把快的那次盖掉
  it('连发两次时只有最后一次能写状态', async () => {
    const slow = deferred<Page<DatasetTableSummary>>()
    const fast = deferred<Page<DatasetTableSummary>>()
    vi.spyOn(dataset, 'listDatasetTables')
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const ledger = useLedgerOptions({ canView: () => true })

    const first = ledger.loadTables()
    const second = ledger.loadTables()
    fast.resolve(pageOf([table('new')]))
    await second
    slow.resolve(pageOf([table('old')]))
    await first

    expect(ledger.tables.value.map((item) => item.code)).toEqual(['new'])
  })
})
