/**
 * @fileoverview 契约：散点五态的画幅算料——抽样、两轴同尺、零线与 ±σ 带、
 * 落在数据之外的参考线、比率曲线的定轴与空心点、以及图下那行结论。
 *
 * ⚠ 退化分支（空序列 / 全等值 / 全零 / 单点 / 负值 / 超上限）在这里钉：
 * 挂载测试量不出一个点的坐标，只有纯函数量得出来。
 */
import { describe, expect, it } from 'vitest'

import type {
  ScatterInput,
  ScatterSeries,
} from '@/pages/Modeling/Canvas/scripts/scatterGeometry'
import { scatterGeometry } from '@/pages/Modeling/Canvas/scripts/scatterGeometry'

/** 画幅四条边，用来核坐标。 */
const LEFT = 38
const RIGHT = 352
const TOP = 14
const BASELINE = 148

function ask(patch: Partial<ScatterInput>): ScatterInput {
  return { mode: 'pairs', series: [], rules: [], band: null, ...patch }
}

function one(points: readonly (readonly [number, number])[]): ScatterSeries[] {
  return [{ name: '这一路', points }]
}

describe('散点画幅：定界与退化', () => {
  it('一路点都没有时说清是空的，结论那行不编数', () => {
    const view = scatterGeometry(ask({ series: [] }))

    expect(view.isBlank).toBe(true)
    expect(view.summary).toBe('共 0 个点')
    expect(view.series).toHaveLength(0)
  })

  it('序列在但点是空数组时，这一路整个不进图例也不占色', () => {
    const view = scatterGeometry(
      ask({ series: [{ name: '空的', points: [] }, ...one([[1, 2]])] }),
    )

    expect(view.series).toHaveLength(1)
    expect(view.series[0]?.name).toBe('这一路')
    expect(view.hasLegend).toBe(false)
  })

  it('只有一个点时照样落在画幅里，坐标不出 NaN', () => {
    const view = scatterGeometry(ask({ series: one([[3, 3]]) }))

    expect(view.isBlank).toBe(false)
    expect(view.series[0]?.dotsPath).not.toContain('NaN')
    expect(view.summary).toBe('共 1 个点；两轴同尺 1.5 ~ 4.5，对角线是理想线')
  })

  it('所有点完全一样时把跨度撑开，不会除到 0', () => {
    const view = scatterGeometry(
      ask({
        series: one([
          [5, 5],
          [5, 5],
        ]),
      }),
    )

    expect(view.summary).toContain('两轴同尺 2.5 ~ 7.5')
    expect(view.series[0]?.dotsPath).not.toContain('NaN')
  })

  it('全是 0 时给一个人为的跨度，点落在正中', () => {
    const view = scatterGeometry(ask({ series: one([[0, 0]]) }))

    expect(view.summary).toContain('两轴同尺 -1 ~ 1')
    const middle = `${(LEFT + RIGHT) / 2 - 2.2},${(TOP + BASELINE) / 2}`
    expect(view.series[0]?.dotsPath).toContain(`M${middle}`)
  })

  it('负值与跨零一起来时两端都在轴上', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: one([
          [-4, -2],
          [-1, 6],
        ]),
      }),
    )

    expect(view.summary).toBe('共 2 个点；横轴 -4 ~ -1，纵轴 -2 ~ 6')
  })

  it('非有限值直接丢掉，不让整张图变 NaN', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: one([
          [0, 0],
          [Number.NaN, 3],
          [2, Number.POSITIVE_INFINITY],
          [4, 4],
        ]),
      }),
    )

    expect(view.summary).toBe('共 2 个点；横轴 0 ~ 4，纵轴 0 ~ 4')
    expect(view.series[0]?.dotsPath).not.toContain('NaN')
  })
})

describe('散点画幅：抽样', () => {
  const many: [number, number][] = Array.from({ length: 600 }, (_, at) => [
    at,
    at * 2,
  ])

  it('超上限时等距抽样，最后那个点也在——不是只画最早的一段', () => {
    const view = scatterGeometry(ask({ mode: 'series', series: one(many) }))

    expect(view.summary).toContain('共 500 个点')
    expect(view.summary).toContain('横轴 0 ~ 599')
    expect(view.sampledNote).toContain('原 600 个')
  })

  it('没超上限时不写抽样那行字', () => {
    const view = scatterGeometry(
      ask({ mode: 'series', series: one(many.slice(0, 500)) }),
    )

    expect(view.sampledNote).toBe('')
    expect(view.summary).toContain('共 500 个点')
  })
})

describe('散点画幅：四态', () => {
  const pairs: [number, number][] = [
    [0, 0],
    [10, 8],
  ]

  it('pairs 两轴同尺，对角线从左下角拉到右上角', () => {
    const view = scatterGeometry(ask({ mode: 'pairs', series: one(pairs) }))

    expect(view.diagonal).toEqual({
      x1: LEFT,
      y1: BASELINE,
      x2: RIGHT,
      y2: TOP,
    })
  })

  it('pairs 两轴共用一把尺子，真值等于预测的那个点正落在对角线上', () => {
    const view = scatterGeometry(
      ask({
        mode: 'pairs',
        series: one([
          [0, 0],
          [10, 8],
          [5, 5],
        ]),
      }),
    )

    // 两轴各定各的界时这个点会离开中心，那条「越贴近虚线越准」就成了假话
    const middle = `${(LEFT + RIGHT) / 2 - 2.2},${(TOP + BASELINE) / 2}`
    expect(view.series[0]?.dotsPath).toContain(`M${middle}`)
    expect(view.xTicks.map((tick) => tick.text)).toEqual(
      view.yTicks.map((tick) => tick.text),
    )
  })

  it('qq 也走两轴同尺，对角线是判据本身', () => {
    const view = scatterGeometry(ask({ mode: 'qq', series: one(pairs) }))

    expect(view.diagonal).not.toBeNull()
    expect(view.summary).toContain('两轴同尺')
  })

  it('residual 不画对角线，改成自带一条零残差线', () => {
    const view = scatterGeometry(
      ask({
        mode: 'residual',
        series: one([
          [1, 2],
          [2, 3],
        ]),
      }),
    )

    expect(view.diagonal).toBeNull()
    expect(view.drawnRules[0]?.text).toBe('零残差 0')
    // 纵轴必须把 0 圈进来，否则看不出偏差偏到哪一边
    expect(view.summary).toContain('纵轴 0 ~ 3')
  })

  it('series 默认画折线，点默认不画', () => {
    const view = scatterGeometry(ask({ mode: 'series', series: one(pairs) }))

    expect(view.series[0]?.linePoints).not.toBe('')
    expect(view.series[0]?.dotsPath).toBe('')
  })

  it('只有一个点的折线改画成点——一个点的 polyline 什么都不画', () => {
    const view = scatterGeometry(
      ask({ mode: 'series', series: [{ name: '一格', points: [[1, 1]] }] }),
    )

    expect(view.series[0]?.linePoints).toBe('')
    expect(view.series[0]?.dotsPath).not.toBe('')
  })

  it('draw=both 时线和点都出', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: [{ name: '两样', points: pairs, draw: 'both' }],
      }),
    )

    expect(view.series[0]?.linePoints).not.toBe('')
    expect(view.series[0]?.dotsPath).not.toBe('')
  })
})

describe('散点画幅：序列色轮与图例', () => {
  const dots: [number, number][] = [
    [0, 0],
    [1, 1],
  ]

  it('「之前」那一路不占色轮的号，后面那路仍是第一色', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: [
          { name: '原始', points: dots, isBefore: true },
          { name: '聚合后', points: dots },
        ],
      }),
    )

    expect(view.series.map((each) => each.tone)).toEqual(['before', 't0'])
    expect(view.hasLegend).toBe(true)
  })

  it('序列多过色轮时绕回第一色，标记形状也跟着轮', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: Array.from({ length: 7 }, (_, at) => ({
          name: `第 ${at} 路`,
          points: dots,
        })),
      }),
    )

    expect(view.series.map((each) => each.tone)).toEqual([
      't0',
      't1',
      't2',
      't3',
      't4',
      't5',
      't0',
    ])
    expect(view.series[0]?.shape).toBe('circle')
    expect(view.series[1]?.shape).toBe('square')
    expect(view.series[2]?.shape).toBe('diamond')
  })

  it('三种标记形状各画各的路径，色档之外还有一重编码', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: Array.from({ length: 3 }, (_, at) => ({
          name: `第 ${at} 路`,
          points: dots,
          draw: 'dots' as const,
        })),
      }),
    )

    // 圆是两段圆弧、方是四条直边、菱形是四个折点
    expect(view.series[0]?.dotsPath).toContain('a2.2,2.2')
    expect(view.series[1]?.dotsPath).toContain('h4.4v4.4')
    expect(view.series[2]?.dotsPath).toContain('L')
    expect(view.series[2]?.dotsPath).not.toContain('a2.2')
  })

  it('只有一路且不是「之前」时不摆图例', () => {
    const view = scatterGeometry(ask({ mode: 'series', series: one(dots) }))

    expect(view.hasLegend).toBe(false)
  })
})

describe('散点画幅：参考线与 ±σ 带', () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 10],
  ]

  it('落在数据范围之外的参考线不画到框外，改成图下一行字', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: one(line),
        rules: [{ at: 80, label: '八成', intent: 'threshold' }],
      }),
    )

    expect(view.drawnRules).toHaveLength(0)
    expect(view.strayRules[0]?.text).toBe('八成 80')
  })

  it('界内的阈值线画出来，标签带上取值', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: one(line),
        rules: [{ at: 8, label: '八成', intent: 'threshold' }],
      }),
    )

    expect(view.drawnRules[0]?.intent).toBe('threshold')
    expect(view.drawnRules[0]?.text).toBe('八成 8')
  })

  it('贴着上边框的参考线把标签改摆到线下面', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: one(line),
        rules: [{ at: 10, label: '顶', intent: 'reference' }],
      }),
    )

    const drawn = view.drawnRules[0]
    expect(drawn?.top).toBe(TOP)
    expect(drawn?.labelTop).toBe(TOP + 9)
  })

  it('上下界颠倒或压成一条线的带一律不画', () => {
    const flat = scatterGeometry(
      ask({
        mode: 'residual',
        series: one(line),
        band: { low: 2, high: 2, label: '±1σ' },
      }),
    )
    const upside = scatterGeometry(
      ask({
        mode: 'residual',
        series: one(line),
        band: { low: 3, high: 1, label: '±1σ' },
      }),
    )

    expect(flat.band).toBeNull()
    expect(upside.band).toBeNull()
  })

  it('±σ 带把自己的上下界一起圈进纵轴，否则会被切掉半截', () => {
    const view = scatterGeometry(
      ask({
        mode: 'residual',
        series: one([
          [1, 1],
          [2, 2],
        ]),
        band: { low: -5, high: 5, label: '±1σ' },
      }),
    )

    expect(view.summary).toContain('纵轴 -5 ~ 5')
    expect(view.band?.height).toBeGreaterThan(0)
    expect(view.band?.label).toBe('±1σ')
  })
})

describe('散点画幅：刻度', () => {
  it('两轴各给一排刻度，坐标落在画幅之内', () => {
    const view = scatterGeometry(
      ask({
        mode: 'series',
        series: one([
          [0, 0],
          [100, 50],
        ]),
      }),
    )

    expect(view.xTicks.length).toBeGreaterThan(0)
    expect(view.yTicks.length).toBeGreaterThan(0)
    for (const tick of view.xTicks) {
      expect(tick.at).toBeGreaterThanOrEqual(LEFT)
      expect(tick.at).toBeLessThanOrEqual(RIGHT)
    }
    for (const tick of view.yTicks) {
      expect(tick.at).toBeGreaterThanOrEqual(TOP)
      expect(tick.at).toBeLessThanOrEqual(BASELINE)
    }
  })
})

describe('散点画幅：比率曲线', () => {
  const curve: [number, number][] = [
    [0, 0],
    [0.2, 0.5],
  ]

  // ⚠ 按数据定界会让「假正率只到 0.2」的那张图铺满整幅，与旁边那张不同尺
  it('两轴钉死在 0–1，不按数据的极值定界', () => {
    const view = scatterGeometry(ask({ mode: 'curve', series: one(curve) }))

    expect(view.xTicks.map((tick) => tick.text)).toEqual([
      '0',
      '0.2',
      '0.4',
      '0.6',
      '0.8',
      '1',
    ])
    expect(view.yTicks.map((tick) => tick.text)).toEqual(
      view.xTicks.map((t) => t.text),
    )
  })

  it('画幅比另外四态高：两轴都是 0–1，横长纵短会把曲线压扁', () => {
    const flat = scatterGeometry(ask({ mode: 'series', series: one(curve) }))
    const tall = scatterGeometry(ask({ mode: 'curve', series: one(curve) }))

    expect(flat.viewBox).toBe('0 0 360 182')
    expect(tall.viewBox).toBe('0 0 360 240')
    expect(tall.plot.baseline).toBe(206)
  })

  it('要对角线才画：ROC 与校准要，PR 的基准是另一条横线', () => {
    const bare = scatterGeometry(ask({ mode: 'curve', series: one(curve) }))
    const asked = scatterGeometry(
      ask({ mode: 'curve', series: one(curve), diagonal: true }),
    )

    expect(bare.diagonal).toBeNull()
    expect(asked.diagonal).toEqual({
      x1: LEFT,
      y1: 206,
      x2: RIGHT,
      y2: TOP,
    })
  })

  it('图下那行结论写明两轴的量程', () => {
    const view = scatterGeometry(
      ask({ mode: 'curve', series: one(curve), diagonal: true }),
    )

    expect(view.summary).toBe('共 2 个点；两轴都是 0 ~ 1 的比率，对角线是基准')
  })
})

describe('散点画幅：空心点', () => {
  const points: [number, number][] = [
    [0.1, 0.2],
    [0.5, 0.6],
    [0.9, 0.9],
  ]

  it('空心那几个单独一条路径，实心的那几个在另一条', () => {
    const view = scatterGeometry(
      ask({
        mode: 'curve',
        series: [{ name: '校准', points, hollow: [false, true, false] }],
      }),
    )
    const [drawn] = view.series

    expect(drawn?.dotsPath.match(/M/g)).toHaveLength(2)
    expect(drawn?.hollowPath.match(/M/g)).toHaveLength(1)
  })

  it('没给空心表时一个空心点都没有', () => {
    const view = scatterGeometry(ask({ mode: 'curve', series: one(points) }))

    expect(view.series[0]?.hollowPath).toBe('')
  })

  // ⚠ 丢非有限值与抽样都按点走：两个数组分开筛，空心就会落到别的点上，而屏幕上
  // 看着完全正常
  it('中间那个点是坏值被丢掉后，空心仍跟着原来那个点走', () => {
    const view = scatterGeometry(
      ask({
        mode: 'curve',
        series: [
          {
            name: '校准',
            points: [
              [0.1, 0.2],
              [Number.NaN, 0.5],
              [0.9, 0.9],
            ],
            hollow: [false, false, true],
          },
        ],
      }),
    )
    const [drawn] = view.series
    const hollowLeft = Number(/M([\d.]+),/.exec(drawn?.hollowPath ?? '')?.[1])

    expect(drawn?.dotsPath.match(/M/g)).toHaveLength(1)
    expect(hollowLeft).toBeGreaterThan(LEFT + (RIGHT - LEFT) * 0.85)
  })

  it('只画线的那一路不画空心点', () => {
    const view = scatterGeometry(
      ask({
        mode: 'curve',
        series: [
          { name: '校准', points, hollow: [true, true, true], draw: 'line' },
        ],
      }),
    )

    expect(view.series[0]?.hollowPath).toBe('')
    expect(view.series[0]?.linePoints).not.toBe('')
  })
})
