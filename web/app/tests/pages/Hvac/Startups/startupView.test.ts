/**
 * @fileoverview 锁住开机事件页的呈现规则：达标时长 0 要显示成 0、结局的中文
 * 说法、覆盖度排序、下钻曲线取哪一段。
 *
 * ⚠ 「0 分钟」是这块最容易被顺手写坏的：`minutes || '—'` 会把「风机一起来就
 * 已经达标」这三成事件静默显示成没达标，而页面上完全看不出少了什么。
 */
import { describe, expect, it } from 'vitest'
import type {
  CombinationCoverage,
  StartupBatch,
  StartupEpisode,
} from '@dt/contracts'

import {
  batchProgress,
  describeRebuild,
  describeSourceRange,
  estimatedShards,
  isFullHistory,
  rebuildRangeProblem,
  combinationOptions,
  curveWindow,
  formatDuration,
  formatRunningSet,
  outcomeIntent,
  outcomeLabel,
  outcomeOptions,
  sortedCoverage,
  toEpisodeRows,
} from '@/pages/Hvac/Startups/startupView'

const STAMP = '2026-08-12T02:00:00.000Z'

function episode(over: Partial<StartupEpisode> = {}): StartupEpisode {
  return {
    started_at: STAMP,
    running_set: ['K01', 'K02'],
    complied_at: '2026-08-12T02:25:00.000Z',
    duration_minutes: 25,
    outcome: 'usable',
    readings: {},
    is_excluded: false,
    exclusion_reason: null,
    ...over,
  }
}

function batch(over: Partial<StartupBatch> = {}): StartupBatch {
  return {
    id: 'b1',
    status: 'ready',
    is_current: true,
    params_fingerprint: 'abc',
    logic_version: 3,
    window_start: '2026-01-01T00:00:00.000Z',
    window_end: '2026-08-01T00:00:00.000Z',
    shard_total: 8,
    shard_done: 8,
    episode_count: 120,
    unmatched_exclusion_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function coverage(serials: string[], count: number): CombinationCoverage {
  return { running_set: serials, usable_count: count }
}

describe('formatDuration', () => {
  it('0 分钟要原样显示成 0——那是「一起来就已经达标」，不是没达标', () => {
    expect(formatDuration(0)).toBe('0 分钟')
  })

  it('没达标才是破折号', () => {
    expect(formatDuration(null)).toBe('—')
  })

  it('正常时长带单位', () => {
    expect(formatDuration(25)).toBe('25 分钟')
  })
})

describe('outcomeLabel / outcomeIntent', () => {
  it.each([
    ['usable', '可用'],
    ['set_changed', '中途改了组合'],
    ['timeout', '超时未达标'],
    ['data_gap', '数据有缺口'],
  ])('%s 说成「%s」', (outcome, label) => {
    expect(outcomeLabel(outcome)).toBe(label)
  })

  it('目录外的新结局原样显示，不吞成空白', () => {
    expect(outcomeLabel('brand_new')).toBe('brand_new')
    expect(outcomeIntent('brand_new')).toBe('neutral')
  })

  it('可用是成功色，数据缺口是危险色', () => {
    expect(outcomeIntent('usable')).toBe('success')
    expect(outcomeIntent('data_gap')).toBe('danger')
  })

  it('筛选选项含「全部」，四个结局一个不少', () => {
    const options = outcomeOptions()
    expect(options[0]?.value).toBe('')
    expect(options).toHaveLength(5)
  })
})

describe('formatRunningSet', () => {
  it('序号用顿号连起来', () => {
    expect(formatRunningSet(['K01', 'K02'])).toBe('K01、K02')
  })

  it('空组合说清是空的，不渲染成一片空白', () => {
    expect(formatRunningSet([])).toBe('（无）')
  })
})

describe('sortedCoverage / combinationOptions', () => {
  it('按可用条数从多到少', () => {
    const sorted = sortedCoverage([
      coverage(['K01'], 3),
      coverage(['K02'], 40),
      coverage(['K03'], 12),
    ])
    expect(sorted.map((item) => item.usable_count)).toEqual([40, 12, 3])
  })

  it('条数相同时按组合名稳定排，不靠输入顺序', () => {
    const sorted = sortedCoverage([coverage(['K09'], 5), coverage(['K02'], 5)])
    expect(sorted.map((item) => item.running_set[0])).toEqual(['K02', 'K09'])
  })

  it('不丢掉条数少的组合——藏起来等于把「这个组合没数据」说成没问题', () => {
    expect(sortedCoverage([coverage(['K01'], 0)])).toHaveLength(1)
  })

  it('筛选选项的取值是逗号分隔的序号，与后端一致', () => {
    const options = combinationOptions([coverage(['K01', 'K02'], 7)])
    expect(options[1]?.value).toBe('K01,K02')
    expect(options[1]?.label).toContain('7')
  })
})

describe('curveWindow', () => {
  it('达标的取起始前 10 分钟到达标后 10 分钟', () => {
    expect(curveWindow(episode())).toEqual({
      from: '2026-08-12T01:50:00.000Z',
      to: '2026-08-12T02:35:00.000Z',
    })
  })

  it('没达标的退到起始 + 100 分钟，正好盖住它被判掉的那一刻', () => {
    const found = curveWindow(
      episode({
        complied_at: null,
        duration_minutes: null,
        outcome: 'timeout',
      }),
    )
    expect(found).toEqual({
      from: '2026-08-12T01:50:00.000Z',
      to: '2026-08-12T03:50:00.000Z',
    })
  })
})

describe('batchProgress', () => {
  it('按分片算百分比', () => {
    expect(batchProgress(batch({ shard_total: 8, shard_done: 2 }))).toBe(25)
  })

  it('分片总数为 0 时算 0，不做除零', () => {
    expect(batchProgress(batch({ shard_total: 0, shard_done: 0 }))).toBe(0)
  })
})

describe('toEpisodeRows', () => {
  it('被排除的事件照样出现在行里，只是带上标记与原因', () => {
    const rows = toEpisodeRows([
      episode({ is_excluded: true, exclusion_reason: '现场检修' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.isExcluded).toBe(true)
    expect(rows[0]?.reason).toBe('现场检修')
  })

  it('行 id 取起始时刻——排除接口就是按它定位的', () => {
    expect(toEpisodeRows([episode()])[0]?.id).toBe(STAMP)
  })

  it('时长 0 的那一行显示 0 分钟', () => {
    const rows = toEpisodeRows([
      episode({ duration_minutes: 0, complied_at: STAMP }),
    ])
    expect(rows[0]?.duration).toBe('0 分钟')
  })

  it('没有排除原因时给空串，不把 null 显示出去', () => {
    expect(toEpisodeRows([episode()])[0]?.reason).toBe('')
  })
})

describe('抽取区间', () => {
  const FULL = {
    from: '2023-01-01T00:00:00.000Z',
    to: '2026-08-01T00:00:00.000Z',
  }

  it('两端都留空是合法的——那就是「全部可用历史」，交给后端算', () => {
    expect(rebuildRangeProblem({ from: '', to: '' })).toBeNull()
    expect(isFullHistory({ from: '', to: '' })).toBe(true)
  })

  it('只填一端也合法，另一端同样交给后端', () => {
    expect(rebuildRangeProblem({ from: FULL.from, to: '' })).toBeNull()
    expect(rebuildRangeProblem({ from: '', to: FULL.to })).toBeNull()
    expect(isFullHistory({ from: FULL.from, to: '' })).toBe(false)
  })

  it('倒置的区间拦下', () => {
    expect(rebuildRangeProblem({ from: FULL.to, to: FULL.from })).toContain(
      '早于',
    )
  })

  it('按月估分片数——2023-01 到 2026-08 正好 43 个月', () => {
    expect(estimatedShards(FULL)).toBe(43)
  })

  it('不足一个月也算一片，不会算成 0', () => {
    expect(
      estimatedShards({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-02T00:00:00.000Z',
      }),
    ).toBe(1)
  })

  it('区间不合法时给 0，不拿 NaN 去拼文案', () => {
    expect(estimatedShards({ from: 'x', to: 'y' })).toBe(0)
  })

  it('确认文案说清抽哪一段、几片，以及旧数据继续服务', () => {
    const text = describeRebuild(FULL, null)
    expect(text).toContain('43 个月度分片')
    expect(text).toContain('上一批次')
  })

  it('没填区间时按数据源的实际范围估——不猜、也不写死任何日期', () => {
    const text = describeRebuild(
      { from: '', to: '' },
      { start: FULL.from, end: FULL.to },
    )
    expect(text).toContain('43 个月度分片')
  })

  it('连数据源范围都拿不到时只说「全部可用历史」，不编一个跨度出来', () => {
    const text = describeRebuild({ from: '', to: '' }, null)
    expect(text).toContain('全部可用历史')
    expect(text).not.toContain('分片')
  })

  it('可用区间说给用户听；拿不到就不说', () => {
    expect(describeSourceRange({ start: FULL.from, end: FULL.to })).toContain(
      '数据源现有',
    )
    expect(describeSourceRange(null)).toBe('')
  })
})
