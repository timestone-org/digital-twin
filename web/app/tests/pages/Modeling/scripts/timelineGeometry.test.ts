/**
 * @fileoverview 契约：时间带的画幅算料——占用段、断档、请求区间与实际区间的
 * 对照、行序轴、以及图下那几行结论。
 *
 * ⚠ 退化分支（零段 / 单点段 / 全是断档 / 段重叠 / 跨年 / 实际远短于请求 /
 * 段数超上限）在这里钉：挂载测试量不出一根条的宽度。
 */
import { describe, expect, it } from 'vitest'

import type {
  TimelineInput,
  TimelineSegment,
} from '@/pages/Modeling/Canvas/scripts/timelineGeometry'
import { timelineGeometry } from '@/pages/Modeling/Canvas/scripts/timelineGeometry'

/** 画幅两条竖边，用来核坐标。 */
const LEFT = 62
const RIGHT = 352

/** ⚠ 用本地时构造：断言的字面量才不随跑用例的机器时区变。 */
function at(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

function ask(patch: Partial<TimelineInput>): TimelineInput {
  return { scale: 'time', rows: [], span: null, ...patch }
}

function seg(
  since: number,
  until: number,
  label = '有数据',
  tone: TimelineSegment['tone'] = 'primary',
): TimelineSegment {
  return { since, until, label, tone }
}

describe('时间带：退化', () => {
  it('一行都没有时说清是空的，不画一张空框', () => {
    const view = timelineGeometry(ask({ rows: [] }))

    expect(view.isBlank).toBe(true)
    expect(view.rows).toHaveLength(0)
  })

  it('有行但一段都没有、又没给请求区间时同样算空', () => {
    const view = timelineGeometry(
      ask({ rows: [{ name: '实际', segments: [] }] }),
    )

    expect(view.isBlank).toBe(true)
  })

  it('给了请求区间就照画，整行都是断档也是一条结论', () => {
    const since = at(2026, 1, 1)
    const until = at(2026, 1, 2)
    const view = timelineGeometry(
      ask({
        rows: [{ name: '实际', segments: [], showGaps: true }],
        span: { low: since, high: until },
      }),
    )

    expect(view.isBlank).toBe(false)
    expect(view.rows[0]?.gaps).toHaveLength(1)
    expect(view.rows[0]?.gaps[0]?.width).toBe(RIGHT - LEFT)
    expect(view.notes).toContain('实际：整段一行数据都没有')
  })

  it('起止相同的一段也要看得见，宽度不许压到 0', () => {
    const stamp = at(2026, 3, 1, 8)
    const view = timelineGeometry(
      ask({ rows: [{ name: '一瞬', segments: [seg(stamp, stamp)] }] }),
    )

    expect(view.rows[0]?.bars[0]?.width).toBeGreaterThanOrEqual(1)
    expect(view.summary).toContain('2026-03-01 07:59 ~ 2026-03-01 08:00')
  })

  it('起止颠倒的一段自己摆正，不画负宽度的条', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          { name: '倒着写', segments: [seg(at(2026, 1, 2), at(2026, 1, 1))] },
        ],
      }),
    )

    expect(view.rows[0]?.bars[0]?.left).toBe(LEFT)
    expect(view.rows[0]?.bars[0]?.width).toBe(RIGHT - LEFT)
  })

  it('非有限的起止直接丢掉，不让整条轴变 NaN', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '有脏数据',
            segments: [
              seg(Number.NaN, at(2026, 1, 2)),
              seg(at(2026, 1, 3), at(2026, 1, 4)),
            ],
          },
        ],
      }),
    )

    expect(view.rows[0]?.bars).toHaveLength(1)
    expect(view.summary).not.toContain('NaN')
  })

  it('请求区间里混进非有限值时按没给它算，轴仍由段自己定', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '实际',
            segments: [seg(at(2026, 1, 2), at(2026, 1, 4))],
          },
        ],
        span: { low: Number.NaN, high: at(2026, 1, 4) },
      }),
    )

    expect(view.summary).toBe(
      '轴上 2026-01-02 00:00 ~ 2026-01-04 00:00（本机时区）',
    )
  })
})

describe('时间带：断档与重叠', () => {
  it('段与段之间的空隙算成断档，首尾两头也算', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '实际',
            segments: [
              seg(at(2026, 1, 2), at(2026, 1, 3)),
              seg(at(2026, 1, 5), at(2026, 1, 6)),
            ],
            showGaps: true,
          },
        ],
        span: { low: at(2026, 1, 1), high: at(2026, 1, 8) },
      }),
    )

    expect(view.rows[0]?.gaps).toHaveLength(3)
    expect(view.notes[0]).toBe('实际：覆盖 28.6%，3 段断档')
  })

  it('重叠的同语义段先并起来，断档不会算成负数', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '滚动窗口',
            segments: [
              seg(at(2026, 1, 1), at(2026, 1, 4)),
              seg(at(2026, 1, 2), at(2026, 1, 6)),
              seg(at(2026, 1, 5), at(2026, 1, 8)),
            ],
            showGaps: true,
          },
        ],
      }),
    )

    expect(view.rows[0]?.bars).toHaveLength(1)
    expect(view.rows[0]?.bars[0]?.title).toContain('等 3 段')
    expect(view.rows[0]?.gaps).toHaveLength(0)
    expect(view.notes).toContain('滚动窗口：整段都有数据')
  })

  it('语义不同的两段贴在一起也各画各的，不并成一条', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '切分',
            segments: [
              seg(at(2026, 1, 1), at(2026, 1, 7), '训练段', 'primary'),
              seg(at(2026, 1, 7), at(2026, 1, 9), '测试段', 'secondary'),
            ],
          },
        ],
      }),
    )

    expect(view.rows[0]?.bars.map((bar) => bar.tone)).toEqual([
      'primary',
      'secondary',
    ])
  })

  it('没开断档的行不算空隙——切分的两段之间不是断档', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '折 1',
            segments: [seg(at(2026, 1, 1), at(2026, 1, 2))],
          },
        ],
        span: { low: at(2026, 1, 1), high: at(2026, 1, 9) },
      }),
    )

    expect(view.rows[0]?.gaps).toHaveLength(0)
    expect(view.notes).toHaveLength(0)
  })
})

describe('时间带：请求区间与实际区间', () => {
  it('实际远短于请求时两条并排画，轴仍按请求的那一头收', () => {
    const asked = { low: at(2026, 1, 1), high: at(2026, 12, 31) }
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '请求区间',
            segments: [seg(asked.low, asked.high, '请求', 'requested')],
          },
          {
            name: '实际取到',
            segments: [seg(at(2026, 12, 20), asked.high, '实际')],
            showGaps: true,
          },
        ],
        span: asked,
      }),
    )

    expect(view.rows).toHaveLength(2)
    expect(view.rows[0]?.bars[0]?.width).toBe(RIGHT - LEFT)
    expect(view.rows[1]?.bars[0]?.width).toBeLessThan((RIGHT - LEFT) / 5)
    expect(view.notes[0]).toContain('实际取到：覆盖 3')
    expect(view.notes[0]).toContain('1 段断档')
  })

  it('所有行共用一把尺子，第二行的起点不会被拉到最左边', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          { name: '训练', segments: [seg(at(2026, 1, 1), at(2026, 1, 5))] },
          { name: '测试', segments: [seg(at(2026, 1, 5), at(2026, 1, 9))] },
        ],
      }),
    )

    expect(view.rows[0]?.bars[0]?.left).toBe(LEFT)
    expect(view.rows[1]?.bars[0]?.left).toBe((LEFT + RIGHT) / 2)
  })
})

describe('时间带：轴与标签', () => {
  it('时刻按本机时区写，结论那行把这件事明说', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          { name: '实际', segments: [seg(at(2026, 5, 1), at(2026, 5, 2))] },
        ],
      }),
    )

    expect(view.summary).toBe(
      '轴上 2026-05-01 00:00 ~ 2026-05-02 00:00（本机时区）',
    )
  })

  it('跨度只有几小时时刻度写到时分', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '实际',
            segments: [seg(at(2026, 5, 1, 8), at(2026, 5, 1, 12))],
          },
        ],
      }),
    )

    expect(view.xTicks.map((tick) => tick.text)).toContain('09:00')
  })

  it('半天一档的刻度落在本机时区的整点上，不是 UTC 的整点', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          { name: '实际', segments: [seg(at(2026, 5, 1), at(2026, 5, 3))] },
        ],
      }),
    )

    expect(view.xTicks.length).toBeGreaterThan(2)
    for (const tick of view.xTicks) {
      expect(['00:00', '12:00']).toContain(tick.text.slice(-5))
    }
  })

  it('跨年时日期刻度补上年份，两个 01-01 不会撞在一起', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '实际',
            segments: [seg(at(2025, 12, 1), at(2026, 1, 20))],
          },
        ],
      }),
    )

    expect(view.xTicks.every((tick) => tick.text.length === 10)).toBe(true)
    expect(view.summary).toContain('2025-12-01')
    expect(view.summary).toContain('2026-01-20')
  })

  it('跨度上到一年多时刻度只写到月', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          { name: '实际', segments: [seg(at(2024, 1, 1), at(2026, 6, 1))] },
        ],
      }),
    )

    expect(view.xTicks.every((tick) => tick.text.length === 7)).toBe(true)
  })

  it('跨度超出步长梯子时一路翻倍，刻度不会排出几十根', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          { name: '实际', segments: [seg(at(2015, 1, 1), at(2026, 1, 1))] },
        ],
      }),
    )

    expect(view.xTicks.length).toBeLessThanOrEqual(5)
    expect(view.xTicks.every((tick) => tick.text.length === 7)).toBe(true)
  })

  it('整分刻度一根都排不下时给起点本身，不给一条没有字的轴', () => {
    const stamp = at(2026, 5, 1, 8, 30) + 10_000
    const view = timelineGeometry(
      ask({
        rows: [{ name: '一瞬', segments: [seg(stamp, stamp + 20_000)] }],
      }),
    )

    expect(view.xTicks).toHaveLength(1)
    expect(view.xTicks[0]?.text).toBe('08:30')
  })

  it('起止相同的瞬时段照样排得出一根刻度', () => {
    const stamp = at(2026, 5, 1, 8, 30)
    const view = timelineGeometry(
      ask({ rows: [{ name: '一瞬', segments: [seg(stamp, stamp)] }] }),
    )

    expect(view.xTicks.length).toBeGreaterThan(0)
  })

  it('行序轴按行号写，不写成时刻', () => {
    const view = timelineGeometry(
      ask({
        scale: 'index',
        rows: [
          {
            name: '折 1',
            segments: [
              seg(0, 800, '训练段'),
              seg(800, 1000, '测试段', 'secondary'),
            ],
          },
        ],
      }),
    )

    expect(view.summary).toBe('轴上 第 0 行 ~ 第 1,000 行')
    expect(view.rows[0]?.bars[1]?.title).toBe('测试段：第 800 行 ~ 第 1,000 行')
    expect(view.xTicks.map((tick) => tick.text)).toContain('500')
  })
})

describe('时间带：上限', () => {
  it('段太多时留最长的那些，两端仍在轴上并把这件事写出来', () => {
    const segments = Array.from({ length: 260 }, (_, index) =>
      seg(
        at(2026, 1, 1) + index * 4 * 3_600_000,
        at(2026, 1, 1) +
          index * 4 * 3_600_000 +
          (index === 259 ? 3_600_000 : 60_000),
      ),
    )
    const view = timelineGeometry(
      ask({ rows: [{ name: '占用', segments, showGaps: true }] }),
    )

    expect(view.rows[0]?.bars).toHaveLength(200)
    expect(view.notes.some((note) => note.includes('段太多'))).toBe(true)
    expect(view.rows[0]?.bars[199]?.title).toContain('2026-02-13')
  })

  it('行太多时只画前几行，剩下的照实说', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      name: `折 ${index}`,
      segments: [seg(index * 10, index * 10 + 5)],
    }))
    const view = timelineGeometry(ask({ scale: 'index', rows }))

    expect(view.rows).toHaveLength(24)
    expect(view.notes).toContain('还有 6 行没有画出来')
  })
})

describe('时间带：图例', () => {
  it('图例只列这份数据里真出现过的那几档', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '切分',
            segments: [
              seg(at(2026, 1, 1), at(2026, 1, 7), '训练段', 'primary'),
              seg(at(2026, 1, 7), at(2026, 1, 9), '测试段', 'shuffled'),
            ],
            showGaps: true,
          },
        ],
      }),
    )

    expect(view.legend.map((item) => item.text)).toEqual(['训练段', '测试段'])
    expect(view.legend.map((item) => item.tone)).toEqual([
      'primary',
      'shuffled',
    ])
  })

  it('长名字截断但整名留在 tooltip 里', () => {
    const view = timelineGeometry(
      ask({
        rows: [
          {
            name: '一个特别长的行名字',
            segments: [seg(at(2026, 1, 1), at(2026, 1, 2))],
          },
        ],
      }),
    )

    expect(view.rows[0]?.name).toBe('一个特别长的行…')
    expect(view.rows[0]?.fullName).toBe('一个特别长的行名字')
  })
})
