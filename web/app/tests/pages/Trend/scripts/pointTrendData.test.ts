/**
 * @fileoverview 锁住点位那一面的两件纯活：没开归档的点位必须在名字上标出来，
 * 以及**任何一个点位取数失败整次就失败**——绝不返回半张图。
 *
 * ⚠ 半张图在界面上看不出缺了什么：少的那条线与「这个点位没数据」长得一样。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectPoint } from '@dt/contracts'

import * as histories from '@/api/pointHistories'
import {
  POINT_TREND_LIMIT,
  readPointReadings,
  toTrendItem,
} from '@/pages/Trend/scripts/pointTrendData'

function point(over: Partial<CollectPoint> = {}): CollectPoint {
  return {
    id: 'p1',
    source_id: 's1',
    node_key: 's1:p1',
    code: 'p1',
    name: '车间温度',
    address: 'ns=2;s=T1',
    data_type: 'float',
    unit: '℃',
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

const FROM = Date.parse('2026-08-24T00:00:00.000Z')
const TO = Date.parse('2026-08-24T06:00:00.000Z')

beforeEach(() => {
  vi.spyOn(histories, 'fetchPointHistory').mockResolvedValue({
    points: [{ t: FROM, v: 21 }],
    isTruncated: false,
    isStale: false,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('摊成勾选项', () => {
  it('量纲进名字，也当 Y 轴分组键', () => {
    const item = toTrendItem(point())
    expect(item.label).toBe('车间温度（℃）')
    expect(item.unit).toBe('℃')
    expect(item.key).toBe('s1:p1')
  })

  it('⚠ 没开归档的点位当场标出来：它永远取不到一条读数', () => {
    expect(toTrendItem(point({ archive_enabled: false })).label).toContain(
      '未记录历史',
    )
  })

  it('没有量纲时不硬编一个空括号', () => {
    expect(toTrendItem(point({ unit: null })).label).toBe('车间温度')
  })
})

describe('逐个点位取读数', () => {
  it('窗口两端与点数上限一起下去，上限与截断提示里说的那个数是同一个', async () => {
    await readPointReadings([toTrendItem(point())], FROM, TO)
    expect(vi.mocked(histories.fetchPointHistory)).toHaveBeenCalledWith({
      nodeKey: 's1:p1',
      range: { fromMs: FROM, toMs: TO, limit: POINT_TREND_LIMIT },
    })
  })

  it('⚠ 一个点位失败整次就 reject，绝不返回半张图', async () => {
    vi.mocked(histories.fetchPointHistory)
      .mockResolvedValueOnce({ points: [], isTruncated: false, isStale: false })
      .mockRejectedValueOnce(new Error('归档库连不上'))
    await expect(
      readPointReadings(
        [toTrendItem(point()), toTrendItem(point({ node_key: 's1:p2' }))],
        FROM,
        TO,
      ),
    ).rejects.toThrow('归档库连不上')
  })

  it('任一点位触顶就把触顶如实带上来', async () => {
    vi.mocked(histories.fetchPointHistory).mockResolvedValue({
      points: [],
      isTruncated: true,
      isStale: false,
    })
    const found = await readPointReadings([toTrendItem(point())], FROM, TO)
    expect(found[0]?.isTruncated).toBe(true)
  })
})
