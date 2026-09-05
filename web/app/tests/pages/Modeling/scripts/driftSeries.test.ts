/**
 * @fileoverview 按时刻分格的那一档折成序列的算料：认不认得出、横轴用哪一档
 * 单位、读不出来的那一格怎么办。
 *
 * ⚠ 横轴一律「距起点的多少个单位」：直接把毫秒时间戳丢给散点的话，刻度会印成
 * 一串 1.75e12（规格 §5-22）。
 */
import { describe, expect, it } from 'vitest'

import {
  buildDrift,
  isDrift,
} from '@/pages/Modeling/Canvas/scripts/driftSeries'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const SINCE = Date.UTC(2026, 0, 1, 0, 0)

/** 一块按时刻分格的 payload：每格一个均值。Args: step, count。 */
function driftOf(step: number, count: number): Record<string, unknown> {
  return {
    items: Array.from({ length: count }, (_, seat) => ({
      name: `第 ${seat} 格`,
      value: seat,
      count: 12,
      since: SINCE + seat * step,
      until: SINCE + (seat + 1) * step,
    })),
  }
}

describe('认不认得出', () => {
  it('逐项带得出时刻与值就是这一档', () => {
    expect(isDrift(driftOf(HOUR, 3))).toBe(true)
  })

  it('一项都没有的块不是这一档', () => {
    expect(isDrift({ items: [] })).toBe(false)
    expect(isDrift({})).toBe(false)
  })

  it('逐折分数那种只有名字与值的块不是这一档', () => {
    const folds = { items: [{ name: '第 1 折', value: 0.9 }] }

    expect(isDrift(folds)).toBe(false)
    expect(buildDrift(folds, '逐折分数')).toBeNull()
  })
})

describe('横轴的单位跟着整段跨度走', () => {
  function labelOf(step: number, count: number): string {
    return buildDrift(driftOf(step, count), '残差随时间')?.xLabel ?? ''
  }

  it('跨了几分钟按分钟，跨了几小时按小时，跨了几天按天', () => {
    expect(labelOf(SECOND, 30)).toContain('的秒数')
    expect(labelOf(MINUTE, 30)).toContain('的分钟数')
    expect(labelOf(HOUR, 12)).toContain('的小时数')
    expect(labelOf(DAY, 7)).toContain('的天数')
  })

  it('横轴的数是距起点的第几个单位，不是毫秒时间戳', () => {
    const view = buildDrift(driftOf(HOUR, 3), '残差随时间')

    expect(view?.series[0]?.points).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ])
  })

  it('起点写在轴名与图下那句里，一格数也一并说清', () => {
    const view = buildDrift(driftOf(HOUR, 3), '残差随时间')

    expect(view?.note).toContain('3 格，每格一个均值')
    expect(view?.xLabel).toContain('2026-01-01')
  })
})

describe('退化输入', () => {
  it('时刻或值读不出来的那一格不画，也不折成 0', () => {
    const view = buildDrift(
      {
        items: [
          { name: 'a', value: 1, since: SINCE },
          { name: 'b', value: null, since: SINCE + HOUR },
          { name: 'c', value: 3, since: null },
          { name: 'd', value: 4, since: SINCE + 3 * HOUR },
        ],
      },
      '残差随时间',
    )

    expect(view?.series[0]?.points).toEqual([
      [0, 1],
      [3, 4],
    ])
  })

  it('一格都读不出来时给 null：那时该退回原来的横条画法', () => {
    expect(buildDrift({ items: [{ since: 'x', value: 1 }] }, '名')).toBeNull()
  })

  it('只有一格时用最细的那一档，不除以零', () => {
    const view = buildDrift(driftOf(HOUR, 1), '残差随时间')

    expect(view?.series[0]?.points).toEqual([[0, 0]])
    expect(view?.xLabel).toContain('的秒数')
  })
})
