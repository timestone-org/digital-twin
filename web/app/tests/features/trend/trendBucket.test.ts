/**
 * @fileoverview 锁住桶宽的选法与断档的插法。
 *
 * ⚠ 选得太粗与选得太细都不会报错：太粗是尖峰被均值抹平（曲线看着很正常），
 * 太细是问超后端的桶数上限、换回一条被截了尾的曲线（也看着很正常）。两头都
 * 只能靠用例钉住。
 */
import { describe, expect, it } from 'vitest'

import {
  TREND_BUCKET_CAP,
  bucketTruncationHint,
  chooseTrendBucket,
  withBucketGaps,
} from '@/features/trend/trendBucket'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('按窗口选桶宽', () => {
  it.each([
    [HOUR, '30s'],
    [6 * HOUR, '2m'],
    [24 * HOUR, '10m'],
    [7 * DAY, '1h'],
    [30 * DAY, '6h'],
  ])('%i 毫秒的窗口落在 %s 这一档', (windowMs, expected) => {
    expect(chooseTrendBucket(windowMs).value).toBe(expected)
  })

  it('⚠ 任何窗口选出来的桶数都不许越过后端那个上限', () => {
    for (const windowMs of [
      1000,
      MINUTE,
      HOUR,
      6 * HOUR,
      24 * HOUR,
      7 * DAY,
      30 * DAY,
      365 * DAY,
      3650 * DAY,
    ]) {
      const bucket = chooseTrendBucket(windowMs)
      expect(windowMs / bucket.ms).toBeLessThanOrEqual(TREND_BUCKET_CAP)
    }
  })

  it('⚠ 也不能一味往粗里选：能装下的最细那一档才是答案', () => {
    // 1 小时按 30 秒是 120 格；再细一档（15 秒）就是 240 格，越过上限
    expect(chooseTrendBucket(HOUR).value).toBe('30s')
  })

  it('粗到一天都装不下时落到「几天一桶」，而不是拿最粗那一档硬上', () => {
    const bucket = chooseTrendBucket(1000 * DAY)
    expect(bucket.value).toMatch(/^\d+d$/)
    expect((1000 * DAY) / bucket.ms).toBeLessThanOrEqual(TREND_BUCKET_CAP)
  })

  it('零长与负长窗口也给得出一档，不是 NaN', () => {
    expect(chooseTrendBucket(0).ms).toBeGreaterThan(0)
    expect(chooseTrendBucket(-1).ms).toBeGreaterThan(0)
  })

  it('桶宽的写法落在后端那条正则的形状里', () => {
    for (const windowMs of [1000, HOUR, 30 * DAY, 5000 * DAY]) {
      expect(chooseTrendBucket(windowMs).value).toMatch(/^\d{1,4}[smhd]$/)
    }
  })
})

describe('桶之间的空洞', () => {
  const point = (minute: number, v: number) => ({ t: minute * MINUTE, v })

  it('⚠ 空过一大截时插一个断档点，别让两端被连成一条直线', () => {
    const found = withBucketGaps([point(0, 1), point(10, 2)], MINUTE)
    expect(found.map((one) => one.v)).toEqual([1, null, 2])
    expect(found[1]?.t).toBe(MINUTE)
  })

  it('挨着的桶之间不插', () => {
    const found = withBucketGaps([point(0, 1), point(1, 2)], MINUTE)
    expect(found).toHaveLength(2)
  })

  it('差一格半以内不算空洞——桶起点由库按时区对齐，前端不复算那份对齐', () => {
    const found = withBucketGaps(
      [
        { t: 0, v: 1 },
        { t: 1.4 * MINUTE, v: 2 },
      ],
      MINUTE,
    )
    expect(found).toHaveLength(2)
  })

  it('空序列与单点序列原样回来', () => {
    expect(withBucketGaps([], MINUTE)).toEqual([])
    expect(withBucketGaps([point(0, 1)], MINUTE)).toHaveLength(1)
  })
})

describe('触顶那一句', () => {
  it('说清缺的是更晚那一段，也说清用的是多粗的桶', () => {
    const hint = bucketTruncationHint(chooseTrendBucket(24 * HOUR))
    expect(hint).toContain('10 分钟')
    expect(hint).toContain('更晚')
    expect(hint).not.toContain('更早')
  })
})
