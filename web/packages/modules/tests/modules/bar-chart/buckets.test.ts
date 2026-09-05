/**
 * @fileoverview 守历史档类目轴的三件事：时刻轴取的是几行的并集而不是第一行那一条、
 * 刻度按相邻类目的最小间隔选档（不是按总跨度）、逐行对齐时缺格补 null 而不是 0。
 *
 * ⚠ 取数窗口住在每条绑定上，同一块图里两行的窗口与桶宽可以不同：拿第一行的时刻
 * 当轴，第二行的点会整片对不上位、静默画不出来，而 option 的形状完全合法。
 */
import { describe, expect, it } from 'vitest'

import {
  alignTo,
  buildGrid,
  labelOf,
  stepOf,
} from '../../../src/modules/bar-chart/buckets'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 2026-03-04 09:30:00 本地时。刻度写的是本地时，样本也按本地时构造。 */
const BASE = new Date(2026, 2, 4, 9, 30, 0).getTime()

describe('相邻类目的间隔', () => {
  it('取最小的那一个：混着两种桶宽时按粗的写刻度会让细的那几格重名', () => {
    expect(stepOf([0, HOUR, HOUR + MIN, 3 * HOUR])).toBe(MIN)
  })

  it('不足两个时刻、或时刻全同，都给 0 而不是无穷大', () => {
    expect(stepOf([])).toBe(0)
    expect(stepOf([BASE])).toBe(0)
    expect(stepOf([BASE, BASE])).toBe(0)
  })
})

describe('刻度文案', () => {
  it('秒级桶写到秒，分钟级写到分', () => {
    expect(labelOf(BASE, 10_000, HOUR)).toBe('09:30:00')
    expect(labelOf(BASE, 5 * MIN, HOUR)).toBe('09:30')
  })

  it('跨了不止一天却还按分钟走的，刻度上带日期', () => {
    expect(labelOf(BASE, HOUR, 3 * DAY)).toBe('03-04 09:30')
  })

  it('日桶只写日期，月桶带上年份', () => {
    expect(labelOf(BASE, DAY, 30 * DAY)).toBe('03-04')
    expect(labelOf(BASE, 40 * DAY, 400 * DAY)).toBe('2026-03-04')
  })

  it('时刻不是个数时给空串，不写出一个 Invalid Date', () => {
    expect(labelOf(Number.NaN, HOUR, HOUR)).toBe('')
  })
})

describe('共享时刻轴', () => {
  it('几行的时刻取并集、升序去重，两行窗口不同也各画各的', () => {
    const grid = buildGrid([
      [
        { t: BASE, v: 1 },
        { t: BASE + HOUR, v: 2 },
      ],
      [
        { t: BASE + HOUR, v: 3 },
        { t: BASE + 2 * HOUR, v: 4 },
      ],
    ])

    expect(grid.stamps).toEqual([BASE, BASE + HOUR, BASE + 2 * HOUR])
    expect(grid.labels).toEqual(['09:30', '10:30', '11:30'])
  })

  it('缺席的行不参与并集，坏时刻整点剔掉', () => {
    const grid = buildGrid([
      undefined,
      [
        { t: BASE, v: 1 },
        { t: Number.NaN, v: 2 },
      ],
    ])

    expect(grid.stamps).toEqual([BASE])
  })

  it('一个点都没有时轴是空的，而不是凭空造一格', () => {
    expect(buildGrid([undefined, []])).toEqual({ stamps: [], labels: [] })
  })
})

describe('逐行对齐', () => {
  it('缺格补 null 而不是 0：柱图上 0 是一个真读数', () => {
    expect(
      alignTo([BASE, BASE + HOUR, BASE + 2 * HOUR], [{ t: BASE + HOUR, v: 5 }]),
    ).toEqual([null, 5, null])
  })

  it('非数值的读数按缺格处理，不把字符串塞进值轴', () => {
    expect(alignTo([BASE], [{ t: BASE, v: 'off' }])).toEqual([null])
    expect(alignTo([BASE], [{ t: BASE, v: Number.POSITIVE_INFINITY }])).toEqual(
      [null],
    )
  })

  it('同一时刻出现两次时留后一条，那是补齐的那一条', () => {
    expect(
      alignTo(
        [BASE],
        [
          { t: BASE, v: 1 },
          { t: BASE, v: 9 },
        ],
      ),
    ).toEqual([9])
  })

  it('这一行整个缺席时给一整行 null，不给一个空数组', () => {
    expect(alignTo([BASE, BASE + HOUR], undefined)).toEqual([null, null])
  })
})
