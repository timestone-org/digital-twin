/**
 * @fileoverview 直方图的画幅算料。这里钉的全是退化输入：空箱、全零、极不均衡、
 * 离轴柱比谁都高、参考线落在数据之外——这几种在真数据上一定会出现，而它们
 * 出错的样子是「图看着挺正常，账对不上」。
 */
import { describe, expect, it } from 'vitest'

import type {
  HistogramBin,
  HistogramInput,
  HistogramMark,
} from '@/pages/Modeling/Canvas/scripts/histogramGeometry'
import { histogramGeometry } from '@/pages/Modeling/Canvas/scripts/histogramGeometry'

function viewOf(
  patch: Partial<HistogramInput>,
): ReturnType<typeof histogramGeometry> {
  return histogramGeometry({
    bins: [],
    marks: [],
    offAxis: null,
    curve: null,
    droppedLabel: '丢弃',
    ...patch,
  })
}

const THREE: HistogramBin[] = [
  { low: -2, high: -1, count: 3 },
  { low: -1, high: 0, count: 9 },
  { low: 0, high: 1, count: 4 },
]

describe('柱', () => {
  it('一箱一根柱，宽度按区间投影而不是等分槽位', () => {
    const view = viewOf({
      bins: [
        { low: 0, high: 1, count: 2 },
        { low: 1, high: 9, count: 2 },
      ],
    })

    expect(view.bars).toHaveLength(2)
    expect(view.bars[1]?.width).toBeGreaterThan(view.bars[0]?.width ?? 0)
  })

  it('柱高按最高的一根折算，最高那根顶到画幅上沿', () => {
    const view = viewOf({ bins: THREE })

    expect(view.bars[1]?.keptTop).toBe(view.plot.top)
    expect(view.bars[0]?.keptHeight).toBeLessThan(view.bars[1]?.keptHeight ?? 0)
  })

  it('tooltip 写区间与计数', () => {
    const view = viewOf({ bins: [{ low: -2.5, high: -1, count: 1234 }] })

    expect(view.bars[0]?.title).toBe('-2.5 ~ -1：1,234 行')
  })

  it('有丢弃段时 tooltip 连丢了多少一起写', () => {
    const view = viewOf({
      bins: [{ low: 0, high: 1, count: 10, dropped: 3 }],
      droppedLabel: '被裁剪',
    })

    expect(view.bars[0]?.title).toContain('其中 3 行被裁剪')
  })

  it('只有一根柱时照画，不因为跨度算法退化而消失', () => {
    const view = viewOf({ bins: [{ low: 1, high: 2, count: 5 }] })

    expect(view.bars).toHaveLength(1)
    expect(view.bars[0]?.keptHeight).toBeGreaterThan(0)
    expect(view.isBlank).toBe(false)
  })

  it('区间宽度为 0 的柱也留得下一根线宽', () => {
    const view = viewOf({ bins: [{ low: 3, high: 3, count: 5 }] })

    expect(view.bars[0]?.width).toBeGreaterThanOrEqual(1)
  })

  it('全零计数时一根柱都不画，但轴还在', () => {
    const view = viewOf({
      bins: [
        { low: 0, high: 1, count: 0 },
        { low: 1, high: 2, count: 0 },
      ],
    })

    expect(view.bars.every((bar) => bar.keptHeight === 0)).toBe(true)
    expect(view.isBlank).toBe(false)
    expect(view.summary).toBe('轴上共 0 行')
  })

  // ⚠ 最高柱是次高的 1000 倍时，小柱按比例算出来不到一个像素、会整根消失
  it('计数极不均衡时小柱也留得住', () => {
    const view = viewOf({
      bins: [
        { low: 0, high: 1, count: 1000 },
        { low: 1, high: 2, count: 1 },
      ],
    })

    expect(view.bars[1]?.keptHeight).toBeGreaterThanOrEqual(1)
  })

  it('负区间的柱从左往右排', () => {
    const view = viewOf({
      bins: [
        { low: -9, high: -5, count: 1 },
        { low: -5, high: -1, count: 2 },
      ],
    })

    expect(view.bars[0]?.left).toBeLessThan(view.bars[1]?.left ?? 0)
    expect(view.bars[0]?.left).toBe(view.plot.left)
  })
})

describe('丢弃段', () => {
  it('丢弃段叠在保留段上面，两段合起来是这一箱的全部', () => {
    const view = viewOf({ bins: [{ low: 0, high: 1, count: 10, dropped: 4 }] })
    const bar = view.bars[0]

    expect(bar?.dropTop).toBeLessThan(bar?.keptTop ?? 0)
    expect((bar?.keptHeight ?? 0) + (bar?.dropHeight ?? 0)).toBeCloseTo(
      view.plot.baseline - (bar?.dropTop ?? 0),
    )
  })

  it('丢弃数是负数时当 0，不画出负高度的柱', () => {
    const view = viewOf({ bins: [{ low: 0, high: 1, count: 10, dropped: -4 }] })

    expect(view.bars[0]?.dropHeight).toBe(0)
    expect(view.hasDropped).toBe(false)
  })

  it('丢弃数比总数还大时夹到总数，保留段清零', () => {
    const view = viewOf({ bins: [{ low: 0, high: 1, count: 10, dropped: 99 }] })

    expect(view.bars[0]?.keptHeight).toBe(0)
    expect(view.summary).toContain('丢弃 10 行（100%）')
  })

  it('结论那行写清丢了多少、占几成', () => {
    const view = viewOf({
      bins: [
        { low: 0, high: 1, count: 8, dropped: 2 },
        { low: 1, high: 2, count: 2, dropped: 1 },
      ],
    })

    expect(view.summary).toBe('轴上共 10 行；丢弃 3 行（30%）')
  })
})

describe('参考竖线', () => {
  it('范围之内的画出来，标签带上值', () => {
    const view = viewOf({
      bins: THREE,
      marks: [{ at: 0, label: '零误差', intent: 'warning' }],
    })

    expect(view.drawnMarks).toHaveLength(1)
    expect(view.drawnMarks[0]?.text).toBe('零误差 0')
    expect(view.strayMarks).toHaveLength(0)
  })

  // ⚠ 画到框外去会骗人：一条贴着边框的线看着就像「阈值正好在边上」
  it('落在数据范围之外的不画线，改成图下一行字', () => {
    const view = viewOf({
      bins: [{ low: 1, high: 2, count: 5 }],
      marks: [{ at: 12.5, label: '阈值', intent: 'danger' }],
    })

    expect(view.drawnMarks).toHaveLength(0)
    expect(view.strayMarks[0]?.text).toBe('阈值 12.5')
  })

  it('全同号的残差让零线落到范围之外', () => {
    const view = viewOf({
      bins: [{ low: 1, high: 2, count: 5 }],
      marks: [{ at: 0, label: '零误差', intent: 'warning' }],
    })

    expect(view.drawnMarks).toHaveLength(0)
  })

  it('贴着右边的标签改成右对齐，免得写出画幅', () => {
    const view = viewOf({
      bins: THREE,
      marks: [
        { at: -2, label: '下界', intent: 'danger' },
        { at: 1, label: '上界', intent: 'danger' },
      ],
    })

    expect(view.drawnMarks[0]?.anchor).toBe('start')
    expect(view.drawnMarks[1]?.anchor).toBe('end')
  })

  // ⚠ 翻不翻要看这条标签自己有多宽：按一个定死的边距判，长标签在离右边还
  // 有一截时就已经写出画幅了
  it('长标签离右边还有一截就翻，短标签在同一处不翻', () => {
    const marks = (label: string): HistogramMark[] => [
      { at: 0.5, label, intent: 'info' },
    ]
    const long = viewOf({ bins: THREE, marks: marks('上界 P99 分位点') })
    const short = viewOf({ bins: THREE, marks: marks('界') })

    expect(long.drawnMarks[0]?.anchor).toBe('end')
    expect(short.drawnMarks[0]?.anchor).toBe('start')
  })
})

// ⚠ `clip_outlier` / `filter_rows` 这类算子一次给三条线是常态，只有「贴右边
// 翻转」那一档时，中间那条与右边那条一定叠成乱码
describe('参考线标签的避让', () => {
  const CLIP: HistogramBin[] = Array.from({ length: 12 }, (_, seat) => ({
    low: seat,
    high: seat + 1,
    count: 10,
  }))
  const ONE_LINE: HistogramMark[] = [
    { at: 1.5, label: '下界 P1', intent: 'danger' },
  ]
  const THREE_LINES: HistogramMark[] = [
    ...ONE_LINE,
    { at: 9.4, label: '均值', intent: 'info' },
    { at: 11.2, label: '上界 P99', intent: 'danger' },
  ]

  it('三条挨得很近的线，标签上下错开而不是叠在一行', () => {
    const view = viewOf({ bins: CLIP, marks: THREE_LINES })
    const tops = view.drawnMarks.map((mark) => mark.labelTop)

    expect(view.drawnMarks.map((mark) => mark.text)).toEqual([
      '下界 P1 1.5',
      '均值 9.4',
      '上界 P99 11.2',
    ])
    expect(new Set(tops).size).toBe(2)
    expect(tops[1]).not.toBe(tops[2])
  })

  it('错行的那条线跟着标签一起往上顶，字与线还连着', () => {
    const view = viewOf({ bins: CLIP, marks: THREE_LINES })

    for (const mark of view.drawnMarks) {
      expect(mark.lineTop).toBeLessThan(mark.labelTop)
      expect(mark.lineTop).toBeGreaterThanOrEqual(0)
    }
    expect(view.drawnMarks[1]?.lineTop).toBeLessThan(
      view.drawnMarks[2]?.lineTop ?? 0,
    )
  })

  it('错了一行就把画幅顶部让出来，柱子不许压到标签上', () => {
    const one = viewOf({ bins: CLIP, marks: ONE_LINE })
    const three = viewOf({ bins: CLIP, marks: THREE_LINES })

    expect(three.plot.top).toBeGreaterThan(one.plot.top)
    for (const bar of three.bars) {
      expect(bar.keptTop).toBeGreaterThanOrEqual(three.plot.top)
    }
  })

  it('离得远的两条线仍旧摆在同一行，不无谓错行', () => {
    const view = viewOf({
      bins: CLIP,
      marks: [
        { at: 1, label: '下界', intent: 'danger' },
        { at: 10, label: '上界', intent: 'danger' },
      ],
    })

    expect(view.drawnMarks[0]?.labelTop).toBe(view.drawnMarks[1]?.labelTop)
    expect(view.plot.top).toBe(viewOf({ bins: CLIP }).plot.top)
  })

  // ⚠ 两行都塞不下时宁可少画一个标签，也不许叠成乱码；但少画的那个要有人认领
  it('两行都塞不下的不画字，改由结论那行点名', () => {
    const view = viewOf({
      bins: [{ low: 0, high: 100, count: 10 }],
      marks: [
        { at: 50, label: '下界', intent: 'danger' },
        { at: 51, label: '均值', intent: 'info' },
        { at: 52, label: '上界', intent: 'danger' },
      ],
    })

    expect(view.drawnMarks).toHaveLength(3)
    expect(view.drawnMarks[2]?.text).toBe('')
    expect(view.summary).toContain('上界 52 与相邻的线挤在一处')
  })
})

describe('离轴柱', () => {
  it('与柱共用同一把纵向尺子，比谁都高时把别的柱压下去', () => {
    const view = viewOf({
      bins: [{ low: 0, high: 1, count: 2 }],
      offAxis: { label: '空值', count: 500 },
    })

    expect(view.offAxis?.top).toBe(view.plot.top)
    expect(view.bars[0]?.keptTop).toBeGreaterThan(view.offAxis?.top ?? 0)
    expect(view.offAxis?.height).toBeLessThanOrEqual(
      view.plot.baseline - view.plot.top,
    )
  })

  it('它独占右边一栏，柱区跟着让出宽度', () => {
    const wide = viewOf({ bins: [{ low: 0, high: 1, count: 2 }] })
    const view = viewOf({
      bins: [{ low: 0, high: 1, count: 2 }],
      offAxis: { label: '空值', count: 3 },
    })

    expect(view.plot.right).toBeLessThan(wide.plot.right)
    expect(view.offAxis?.left).toBeGreaterThan(view.plot.right)
  })

  it('计数为 0 的离轴柱不摆，也不占那一栏', () => {
    const bins = [{ low: 0, high: 1, count: 2 }]
    const view = viewOf({ bins, offAxis: { label: '空值', count: 0 } })

    expect(view.offAxis).toBeNull()
    expect(view.plot.right).toBe(viewOf({ bins }).plot.right)
  })

  it('结论那行写明这些行不在这条轴上', () => {
    const view = viewOf({
      bins: [{ low: 0, high: 1, count: 2 }],
      offAxis: { label: '空值', count: 2891 },
    })

    expect(view.summary).toBe('轴上共 2 行；空值：2,891 行（不在这条轴上）')
  })

  it('一根柱都没有但有离轴柱时照画，不当空图', () => {
    const view = viewOf({ offAxis: { label: '空值', count: 12 } })

    expect(view.isBlank).toBe(false)
    expect(view.offAxis?.height).toBeGreaterThan(0)
  })
})

describe('正态参考曲线', () => {
  it('给了均值与离散度就画一条', () => {
    const view = viewOf({ bins: THREE, curve: { mean: -0.5, sd: 1 } })

    expect(view.curvePoints.split(' ')).toHaveLength(49)
  })

  it('离散度为 0 时不画：那条曲线是一根无穷高的针', () => {
    expect(viewOf({ bins: THREE, curve: { mean: 0, sd: 0 } }).curvePoints).toBe(
      '',
    )
  })

  it('一行数据都没有时不画', () => {
    const view = viewOf({
      bins: [{ low: 0, high: 1, count: 0 }],
      curve: { mean: 0, sd: 1 },
    })

    expect(view.curvePoints).toBe('')
  })

  it('没有箱子时不画', () => {
    expect(viewOf({ curve: { mean: 0, sd: 1 } }).curvePoints).toBe('')
  })
})

describe('刻度与空态', () => {
  it('横轴刻度落在柱区之内', () => {
    const view = viewOf({ bins: THREE })

    for (const tick of view.xTicks) {
      expect(tick.at).toBeGreaterThanOrEqual(view.plot.left)
      expect(tick.at).toBeLessThanOrEqual(view.plot.right)
    }
  })

  it('纵轴刻度是行数，最底下那根是 0', () => {
    const view = viewOf({ bins: THREE })

    expect(view.yTicks[0]?.text).toBe('0')
    expect(view.yTicks[0]?.at).toBe(view.plot.baseline)
  })

  // ⚠ 纵轴量的是行数，小数刻度会印出「0.5 行」这种不存在的读数
  it('纵轴刻度只给整行数', () => {
    const view = viewOf({ bins: [{ low: 0, high: 1, count: 1 }] })

    expect(view.yTicks.map((tick) => tick.text)).toEqual(['0', '1'])
  })

  it('空箱且没有离轴柱时判成空图', () => {
    const view = viewOf({})

    expect(view.isBlank).toBe(true)
    expect(view.bars).toHaveLength(0)
  })
})
