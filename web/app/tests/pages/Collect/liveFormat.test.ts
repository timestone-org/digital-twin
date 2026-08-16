/**
 * @fileoverview 实时读数在表格里的三档长相。
 *
 * ⚠ 「没收到过」「取不到」「陈旧」合并任意两档都会造出一条假读数。这一组
 * 用例就是那三档的分界线。
 */
import { describe, expect, it } from 'vitest'
import type { PointSample } from '@dt/contracts'

import { formatSample } from '@/pages/Collect/Opcua/liveFormat'
import {
  errorSummary,
  missingPoints,
  stateLook,
} from '@/pages/Collect/Opcua/sourceState'

const AT_MS = Date.UTC(2026, 7, 16, 2, 0, 0)

function ok(value: unknown): PointSample {
  return { state: 'ok', value, timestampMs: AT_MS, quality: 'good' }
}

describe('读数的三档', () => {
  it('没收到过时既不写 0 也不写值，只说「未上报」', () => {
    const look = formatSample(undefined, '℃')
    expect(look.text).toBe('—')
    expect(look.badge).toBe('未上报')
  })

  it('取不到时把原因带出来', () => {
    const look = formatSample(
      { state: 'error', errorMessage: '点位暂无快照值' },
      null,
    )
    expect([look.text, look.badge]).toEqual(['—', '取不到'])
    expect(look.reason).toBe('点位暂无快照值')
  })

  it('陈旧值照显示但标成陈旧', () => {
    const look = formatSample(
      { state: 'stale', value: 12, timestampMs: AT_MS, quality: 'good' },
      '℃',
    )
    expect(look.text).toBe('12 ℃')
    expect(look.badge).toBe('陈旧')
  })

  it('正常现值没有徽标', () => {
    expect(formatSample(ok(12), '℃').badge).toBeNull()
  })
})

describe('值本身', () => {
  it('0 是合法读数，不当成「没有值」', () => {
    expect(formatSample(ok(0), null).text).toBe('0')
  })

  it('false 是合法读数', () => {
    expect(formatSample(ok(false), null).text).toBe('false')
  })

  it('空串是合法读数', () => {
    expect(formatSample(ok(''), null).text).toBe('')
  })

  it('null 如实写成 null，不显示成空', () => {
    expect(formatSample(ok(null), null).text).toBe('null')
  })

  it('有单位时跟在值后面', () => {
    expect(formatSample(ok(1.5), 'kPa').text).toBe('1.5 kPa')
  })
})

describe('质量位', () => {
  it('存疑的质量单独标出来', () => {
    const look = formatSample(
      { state: 'ok', value: 1, timestampMs: AT_MS, quality: 'uncertain' },
      null,
    )
    expect(look.badge).toBe('质量存疑')
  })

  it('陈旧压过质量位——值太旧时它是不是好质量已经不重要', () => {
    const look = formatSample(
      { state: 'stale', value: 1, timestampMs: AT_MS, quality: 'bad' },
      null,
    )
    expect(look.badge).toBe('陈旧')
  })
})

describe('数据源运行态的文案', () => {
  it('未接管与已断开是两档——前者去查采集器，后者去查现场', () => {
    expect(stateLook('unknown').label).not.toBe(stateLook('offline').label)
  })

  it('认不出的状态落到「未知」而不是崩掉', () => {
    expect(stateLook('燃烧中').label).toBe('未知')
  })

  it('报错文案带上归类——归类才决定去查什么', () => {
    expect(
      errorSummary({
        state: 'offline',
        point_count: 0,
        error_category: 'auth',
        error_detail: 'BadUserAccessDenied',
        leader_instance: null,
        updated_at: null,
      }),
    ).toBe('认证被拒（BadUserAccessDenied）')
  })

  it('没有错时不编一句话出来', () => {
    expect(
      errorSummary({
        state: 'online',
        point_count: 3,
        error_category: null,
        error_detail: null,
        leader_instance: 'c1',
        updated_at: null,
      }),
    ).toBeNull()
  })
})

describe('配了却没订上的点位', () => {
  const online = {
    state: 'online' as const,
    point_count: 8,
    error_category: null,
    error_detail: null,
    leader_instance: 'c1',
    updated_at: null,
  }

  it('差额如实报出来——它不会引发任何报错', () => {
    expect(missingPoints(10, online)).toBe(2)
  })

  it('对得上时不提示', () => {
    expect(missingPoints(8, online)).toBeNull()
  })

  it('没在采时不谈差额——那时候一个都没订上，说它没有意义', () => {
    expect(missingPoints(10, { ...online, state: 'offline' })).toBeNull()
  })
})
