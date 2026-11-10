/**
 * @fileoverview 详情页状态：写完列后重取列失败只报在列那一侧，不许把整页换成「加载失败」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatasetTable } from '@dt/contracts'

import * as dataset from '@/api/dataset'
import { useTableDetail } from '@/pages/Dataset/TableDetail/scripts/useTableDetail'

afterEach(() => {
  vi.restoreAllMocks()
})

function table(): DatasetTable {
  return {
    id: 't1',
    code: 'line',
    name: '产线',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 60_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    columns: [],
  }
}

describe('重取列失败', () => {
  it('⚠ 不动整页的 error，另记一份列错误；下次成功清掉', async () => {
    vi.spyOn(dataset, 'getDatasetTable').mockResolvedValue(table())
    const list = vi
      .spyOn(dataset, 'listDatasetColumns')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
    const detail = useTableDetail(() => 't1')
    await detail.load()
    await detail.reloadColumns()
    expect(detail.error.value).toBeNull()
    expect(detail.columnsError.value).not.toBeNull()
    expect(detail.table.value).not.toBeNull()
    await detail.reloadColumns()
    expect(detail.columnsError.value).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('整页重取成功后列清单已是新的，那条列错误一并清掉', async () => {
    vi.spyOn(dataset, 'getDatasetTable').mockResolvedValue(table())
    vi.spyOn(dataset, 'listDatasetColumns').mockRejectedValue(new Error('boom'))
    const detail = useTableDetail(() => 't1')
    await detail.load()
    await detail.reloadColumns()
    expect(detail.columnsError.value).not.toBeNull()
    await detail.load()
    expect(detail.columnsError.value).toBeNull()
  })
})
