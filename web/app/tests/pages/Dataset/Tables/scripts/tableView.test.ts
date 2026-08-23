/**
 * @fileoverview 台账列表那几格的取值口径：关键字按名称与编码两处匹配、桶宽只在
 * 整除时进位、认不出的取数方式原样显示而不是藏起来。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetCollectMode, DatasetTableSummary } from '@dt/contracts'

import {
  collectSummary,
  formatInterval,
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

describe('桶宽的人话', () => {
  it.each([
    [1000, '1 秒'],
    [90_000, '90 秒'],
    [300_000, '5 分钟'],
    [3_600_000, '1 小时'],
    [86_400_000, '1 天'],
  ])('%i 毫秒读作 %s', (ms, text) => {
    expect(formatInterval(ms)).toBe(text)
  })

  it('⚠ 不整除就不进位：台账周期要拿去对采集节拍，四舍五入过的数对不上', () => {
    expect(formatInterval(90_000)).not.toContain('分钟')
  })

  it('比一秒还短的桶宽照实说毫秒，不显示成 0 秒', () => {
    expect(formatInterval(500)).toBe('500 毫秒')
  })
})

describe('取数方式', () => {
  it('人工录入不提周期——它根本不按周期采', () => {
    expect(collectSummary(table()).label).toBe('人工录入')
  })

  it('自动采集把周期一起说出来', () => {
    const summary = collectSummary(
      table({ collect_mode: 'aggregate', collect_interval_ms: 3_600_000 }),
    )
    expect(summary.label).toBe('自动采集 · 每 1 小时')
    expect(summary.hint).toContain('从点位历史汇总')
  })

  it('⚠ 认不出的档位显示原始代码：显示成空白会被读成「这张台账没配」', () => {
    // 后端加了一档而前端还没跟上，是这条分支唯一的来路
    const unknown = table({ collect_mode: 'stream' as DatasetCollectMode })
    expect(collectSummary(unknown).label).toBe('stream')
    expect(collectSummary(unknown).hint).toContain('还不认识')
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
