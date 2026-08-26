/**
 * @fileoverview 锁住取点间隔的档位、自动档的选法，以及空格是怎么补的。
 *
 * ⚠ 选得太粗与选得太细都不会报错：太粗是尖峰被均值抹得平平的（曲线看着很
 * 正常），太细是问超后端的桶数上限、换回一条被截了尾的曲线（也看着很正常）。
 * 两头都只能靠用例钉住。
 * ⚠ 补格那条更隐蔽：不补的话，一个订阅模式下稳定运行的点位会画成一片虚线；
 * 一路补到底的话，「值没变」与「采集断了」在图上就再也分不开。
 */
import { describe, expect, it } from 'vitest'

import {
  TREND_BUCKET_AUTO,
  TREND_BUCKET_CAP,
  bucketTruncationHint,
  chooseTrendBucket,
  holdBucketValues,
  resolveTrendBucket,
  trendBucketChoices,
} from '@/features/trend/trendBucket'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('自动档按窗口选间隔', () => {
  it.each([
    [HOUR, '30s'],
    [6 * HOUR, '2m'],
    [24 * HOUR, '10m'],
    [7 * DAY, '1h'],
    [30 * DAY, '6h'],
  ])('%i 毫秒的窗口落在 %s 这一档', (windowMs, expected) => {
    expect(chooseTrendBucket(windowMs).value).toBe(expected)
  })

  it('⚠ 任何窗口选出来的格子数都不许越过后端那个上限', () => {
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

  it('粗到一天都装不下时落到「几天一格」，而不是拿最粗那一档硬上', () => {
    const bucket = chooseTrendBucket(1000 * DAY)
    expect(bucket.value).toMatch(/^\d+d$/)
    expect((1000 * DAY) / bucket.ms).toBeLessThanOrEqual(TREND_BUCKET_CAP)
  })

  it('零长与负长窗口也给得出一档，不是 NaN', () => {
    expect(chooseTrendBucket(0).ms).toBeGreaterThan(0)
    expect(chooseTrendBucket(-1).ms).toBeGreaterThan(0)
  })

  it('间隔的写法落在后端那条正则的形状里', () => {
    for (const windowMs of [1000, HOUR, 30 * DAY, 5000 * DAY]) {
      expect(chooseTrendBucket(windowMs).value).toMatch(/^\d{1,4}[smhd]$/)
    }
  })
})

describe('界面上手选的那一档', () => {
  it('选得动的原样用', () => {
    expect(resolveTrendBucket(6 * HOUR, '30m').ms).toBe(30 * MINUTE)
  })

  it('自动档跟着窗口走', () => {
    expect(resolveTrendBucket(6 * HOUR, TREND_BUCKET_AUTO).value).toBe('2m')
  })

  it('⚠ 细到会问超上限的一律回落自动档，不硬喂给接口换一条半截曲线', () => {
    expect(resolveTrendBucket(30 * DAY, '1s').value).toBe('6h')
  })

  it('认不出来的取值也回落自动档，而不是换回一个 422', () => {
    expect(resolveTrendBucket(6 * HOUR, '一炷香').value).toBe('2m')
  })
})

describe('档位清单', () => {
  it('自动档排头，标签里写明它这次落在哪一档', () => {
    const [first] = trendBucketChoices(24 * HOUR)
    expect(first?.value).toBe(TREND_BUCKET_AUTO)
    expect(first?.label).toContain('10 分钟')
  })

  it('⚠ 够不着的那几档照样列出来，只是标成点不动', () => {
    const choices = trendBucketChoices(30 * DAY)
    expect(choices.find((one) => one.value === '1s')?.isTooFine).toBe(true)
    expect(choices.find((one) => one.value === '6h')?.isTooFine).toBe(false)
  })

  it('窗口一缩，原来点不动的那几档就选得上了', () => {
    const wide = trendBucketChoices(24 * HOUR)
    const narrow = trendBucketChoices(10 * MINUTE)
    expect(wide.find((one) => one.value === '5s')?.isTooFine).toBe(true)
    expect(narrow.find((one) => one.value === '5s')?.isTooFine).toBe(false)
  })
})

describe('空格怎么补', () => {
  const at = (minute: number, v: number) => ({ t: minute * MINUTE, v })

  function window(
    over: Partial<Parameters<typeof holdBucketValues>[1]> = {},
  ): Parameters<typeof holdBucketValues>[1] {
    return { bucketMs: MINUTE, holdMs: 5 * MINUTE, toMs: 0, ...over }
  }

  it('⚠ 空掉的格保持上一个读数：订阅模式下「没有新读数」就是「值没变」', () => {
    const found = holdBucketValues(
      [at(0, 1), at(3, 2)],
      window({ toMs: 3 * MINUTE }),
    )
    expect(found.map((one) => one.v)).toEqual([1, 1, 1, 2])
    expect(found.map((one) => one.t)).toEqual([
      0,
      MINUTE,
      2 * MINUTE,
      3 * MINUTE,
    ])
  })

  it('⚠ 超过归档心跳还没有读数才画断档，否则「采集断了」再也看不出来', () => {
    const found = holdBucketValues(
      [at(0, 1), at(10, 2)],
      window({ toMs: 10 * MINUTE }),
    )
    // 心跳 5 分钟 ÷ 1 分钟一格 → 结转 5 格，第 6 格是断档
    expect(found.map((one) => one.v)).toEqual([1, 1, 1, 1, 1, 1, null, 2])
  })

  it('挨着的格之间什么都不插', () => {
    const found = holdBucketValues(
      [at(0, 1), at(1, 2)],
      window({ toMs: MINUTE }),
    )
    expect(found).toHaveLength(2)
  })

  it('末尾那一段也照同一条规则结转，但不再多插一个断档点', () => {
    const found = holdBucketValues([at(0, 1)], window({ toMs: 30 * MINUTE }))
    expect(found.map((one) => one.v)).toEqual([1, 1, 1, 1, 1, 1])
    expect(found.at(-1)?.t).toBe(5 * MINUTE)
  })

  it('⚠ 心跳为 0 即完全不结转——台账列走的就是这一档（D3）', () => {
    const found = holdBucketValues(
      [at(0, 1), at(3, 2)],
      window({ holdMs: 0, toMs: 3 * MINUTE }),
    )
    expect(found.map((one) => one.v)).toEqual([1, null, 2])
  })

  it('心跳比一格还短时至少结转一格，不至于每一格都断', () => {
    const found = holdBucketValues(
      [at(0, 1), at(5, 2)],
      window({ holdMs: 1000, toMs: 5 * MINUTE }),
    )
    expect(found.map((one) => one.v)).toEqual([1, 1, null, 2])
  })

  it('空序列原样回来', () => {
    expect(holdBucketValues([], window())).toEqual([])
  })
})

describe('触顶那一句', () => {
  it('说清缺的是更晚那一段，也说清用的是多粗的格子', () => {
    const hint = bucketTruncationHint(chooseTrendBucket(24 * HOUR))
    expect(hint).toContain('10 分钟')
    expect(hint).toContain('更晚')
    expect(hint).not.toContain('更早')
  })
})
