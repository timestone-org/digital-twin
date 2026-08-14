/**
 * @fileoverview 锁住时刻的换算契约：对外一律 UTC RFC3339，显示一律本地时。
 * ⚠ 每条用例都把 TZ 钉死——不钉的话，跑用例的机器在哪个时区会决定断言的对错。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatLocalMinute,
  fromLocalMinuteInput,
  toLocalMinuteInput,
} from '../../src/shared/datetime'

const SHANGHAI = 'Asia/Shanghai' // UTC+8，无夏令时
const NEW_YORK = 'America/New_York' // 八月是 UTC−4，会把同一时刻退回前一天

function inZone<T>(zone: string, read: () => T): T {
  vi.stubEnv('TZ', zone)
  return read()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('toLocalMinuteInput', () => {
  it('UTC 时刻按本地时区显示', () => {
    const iso = '2026-08-12T02:55:00.000Z'
    expect(inZone(SHANGHAI, () => toLocalMinuteInput(iso))).toBe(
      '2026-08-12T10:55',
    )
    expect(inZone('UTC', () => toLocalMinuteInput(iso))).toBe(
      '2026-08-12T02:55',
    )
  })

  it('本地时区落在前一天时日期跟着退', () => {
    expect(
      inZone(NEW_YORK, () => toLocalMinuteInput('2026-08-12T02:55:00.000Z')),
    ).toBe('2026-08-11T22:55')
  })

  it('秒与毫秒被截掉，只到分钟', () => {
    expect(
      inZone('UTC', () => toLocalMinuteInput('2026-08-12T02:55:47.123Z')),
    ).toBe('2026-08-12T02:55')
  })

  it('四位年份不足时补零', () => {
    expect(
      inZone('UTC', () => toLocalMinuteInput('0999-01-02T03:04:00.000Z')),
    ).toBe('0999-01-02T03:04')
  })

  it('空串与解析不出的时刻都给空串', () => {
    expect(inZone('UTC', () => toLocalMinuteInput(''))).toBe('')
    expect(inZone('UTC', () => toLocalMinuteInput('不是时刻'))).toBe('')
  })
})

describe('fromLocalMinuteInput', () => {
  it('本地时的输入换成 UTC RFC3339', () => {
    expect(
      inZone(SHANGHAI, () => fromLocalMinuteInput('2026-08-12T10:55')),
    ).toBe('2026-08-12T02:55:00.000Z')
    expect(inZone('UTC', () => fromLocalMinuteInput('2026-08-12T10:55'))).toBe(
      '2026-08-12T10:55:00.000Z',
    )
  })

  it('本地时早于 UTC 时日期跟着进', () => {
    expect(
      inZone(NEW_YORK, () => fromLocalMinuteInput('2026-08-11T22:55')),
    ).toBe('2026-08-12T02:55:00.000Z')
  })

  it.each([
    ['空串', ''],
    ['带秒', '2026-08-12T10:55:30'],
    ['缺分钟', '2026-08-12T10'],
    ['带时区后缀', '2026-08-12T10:55Z'],
    ['纯文本', 'abc'],
  ])('形状不合法（%s）时给空串', (_name, raw) => {
    expect(inZone(SHANGHAI, () => fromLocalMinuteInput(raw))).toBe('')
  })

  it.each(['2026-13-01T10:55', '2026-08-32T10:55', '2026-08-12T10:60'])(
    '形状对但取值越界（%s）时给空串',
    (raw) => {
      expect(inZone('UTC', () => fromLocalMinuteInput(raw))).toBe('')
    },
  )

  it('两个方向都能原样往返', () => {
    const iso = '2026-01-01T16:00:00.000Z'
    expect(
      inZone(SHANGHAI, () => fromLocalMinuteInput(toLocalMinuteInput(iso))),
    ).toBe(iso)
    const local = '2026-01-02T00:00'
    expect(
      inZone(SHANGHAI, () => toLocalMinuteInput(fromLocalMinuteInput(local))),
    ).toBe(local)
  })
})

describe('formatLocalMinute', () => {
  it('毫秒时间戳按本地时区渲染成年月日时分', () => {
    const epochMs = Date.UTC(2026, 7, 12, 2, 55)
    expect(inZone(SHANGHAI, () => formatLocalMinute(epochMs))).toBe(
      '2026-08-12 10:55',
    )
    expect(inZone('UTC', () => formatLocalMinute(epochMs))).toBe(
      '2026-08-12 02:55',
    )
  })

  it('非有限的时间戳给空串而不是 NaN 字样', () => {
    expect(inZone('UTC', () => formatLocalMinute(Number.NaN))).toBe('')
    expect(
      inZone('UTC', () => formatLocalMinute(Number.POSITIVE_INFINITY)),
    ).toBe('')
  })
})
