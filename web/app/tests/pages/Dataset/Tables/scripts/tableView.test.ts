/**
 * @fileoverview 台账列表那几格的取值口径：关键字按名称与编码两处匹配、
 * 保留期的 null 读作永久而不是「0 天」。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetTableSummary } from '@dt/contracts'

import {
  matchesKeyword,
  retentionLabel,
} from '@/pages/Dataset/Tables/scripts/tableView'

const STAMP = '2026-01-01T00:00:00.000Z'

function table(over: Partial<DatasetTableSummary> = {}): DatasetTableSummary {
  return {
    id: 't1',
    code: 'energy_log',
    name: '能耗台账',
    description: null,
    collect_mode: 'manual',
    collect_interval_ms: 60_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

describe('关键字匹配', () => {
  it('空关键字放行所有行', () => {
    expect(matchesKeyword(table(), '   ')).toBe(true)
  })

  it('名称与编码都在匹配范围内', () => {
    expect(matchesKeyword(table(), '能耗')).toBe(true)
    expect(matchesKeyword(table(), 'energy')).toBe(true)
  })

  it('大小写不敏感——编码是 ASCII，人不会记得自己当初填的是哪种', () => {
    expect(matchesKeyword(table(), 'ENERGY')).toBe(true)
  })

  it('都不沾边就不匹配', () => {
    expect(matchesKeyword(table(), '燃气')).toBe(false)
  })
})

describe('保留期', () => {
  it('null 读作永久，不是「0 天」', () => {
    expect(retentionLabel(null)).toBe('永久')
  })

  it('给了天数就照说', () => {
    expect(retentionLabel(90)).toBe('90 天')
  })
})
