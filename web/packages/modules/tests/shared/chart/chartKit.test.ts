/**
 * @fileoverview 守 option 片段构建器：取不到颜色就省掉那个键（不伪造颜色）、
 * 缺值显「—」而不是 0、tooltip 出口必须转义（函数 formatter 的返回值会被原样
 * innerHTML 进去），以及互斥的定位键不许同时写。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  animationOpts,
  areaFade,
  cartesianGrid,
  categoryAxis,
  dataLabel,
  dataZoomSlider,
  escapeHtml,
  legendStyle,
  linearGradient,
  markLineRef,
  resolvePalette,
  textFactory,
  tooltipStyle,
  TRANSPARENT_BG,
  valueAxis,
  valueText,
  visualMapContinuous,
} from '../../../src/shared/chart/chartKit'
import type { ChartTheme } from '../../../src/shared/chart/theme'

function theme(patch: Partial<ChartTheme> = {}): ChartTheme {
  return {
    palette: [],
    text: '',
    textMuted: '',
    axisLine: '',
    splitLine: '',
    accent: '',
    idle: '',
    tooltipBg: '',
    tooltipBorder: '',
    ...patch,
  }
}

describe('valueText', () => {
  it('缺值显「—」，真实 0 照常显 0', () => {
    expect(valueText(null, 2)).toBe('—')
    expect(valueText(Number.NaN, 2)).toBe('—')
    expect(valueText(0, 2)).toBe('0')
  })

  it('按小数位去尾随零、不加千分位', () => {
    expect(valueText(1234.5, 2)).toBe('1234.5')
    expect(valueText(1.239, 2)).toBe('1.24')
  })

  it('小数位越界钳到 [0,6]——手编配置绕得过面板的 min/max', () => {
    expect(valueText(1.23456789, 99)).toBe('1.234568')
    expect(valueText(1.5, -3)).toBe('2')
  })

  it('不给小数位时最多两位', () => {
    expect(valueText(1.239, null)).toBe('1.24')
  })

  it('单位拼在数值后面', () => {
    expect(valueText(20, 0, '℃')).toBe('20℃')
  })
})

describe('escapeHtml', () => {
  it('五个危险字符全部转义', () => {
    expect(escapeHtml(`<img src=x onerror="y">&'`)).toBe(
      '&lt;img src=x onerror=&quot;y&quot;&gt;&amp;&#39;',
    )
  })

  it('数字照常转成文本', () => {
    expect(escapeHtml(0)).toBe('0')
  })

  it('不是文本的一律给空串，不显示「[object Object]」这种东西', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml({})).toBe('')
  })
})

describe('tooltipStyle', () => {
  it('取不到颜色时不画边框、也不写色键', () => {
    expect(tooltipStyle(theme())).toEqual({
      backgroundColor: undefined,
      borderColor: undefined,
      borderWidth: 0,
      textStyle: { fontSize: 12 },
    })
  })

  it('有边框色才给 1px 边', () => {
    const style = tooltipStyle(theme({ tooltipBorder: 'red', text: 'white' }))

    expect(style).toMatchObject({
      borderColor: 'red',
      borderWidth: 1,
      textStyle: { fontSize: 12, color: 'white' },
    })
  })

  it('字号可覆盖', () => {
    expect(tooltipStyle(theme(), { fontSize: 14 })).toMatchObject({
      textStyle: { fontSize: 14 },
    })
  })
})

describe('legendStyle', () => {
  it('缺省贴底、横向滚动', () => {
    expect(legendStyle(theme())).toMatchObject({
      type: 'scroll',
      bottom: 0,
    })
  })

  it('给了 top 就不再写 bottom——两个都写 echarts 只认一个', () => {
    const legend = legendStyle(theme(), { top: 6, bottom: 12 })

    expect(legend.top).toBe(6)
    expect('bottom' in legend).toBe(false)
  })

  it('没给的定位键一个都不写', () => {
    const legend = legendStyle(theme())

    expect('left' in legend).toBe(false)
    expect('right' in legend).toBe(false)
    expect('data' in legend).toBe(false)
  })

  it('给了才写 left / right / data / selectedMode', () => {
    const legend = legendStyle(theme(), {
      left: 'center',
      right: 10,
      data: ['a'],
      selectedMode: false,
      orient: 'vertical',
    })

    expect(legend).toMatchObject({
      left: 'center',
      right: 10,
      data: ['a'],
      selectedMode: false,
      orient: 'vertical',
    })
  })
})

describe('cartesianGrid', () => {
  it('有图例时给底部让出位置', () => {
    expect(cartesianGrid({ legend: true }).bottom).toBe(26)
    expect(cartesianGrid().bottom).toBe(6)
  })

  it('四边可以给百分比串', () => {
    expect(cartesianGrid({ left: '3%', top: 32 })).toMatchObject({
      left: '3%',
      top: 32,
    })
  })

  it('缺省把刻度文字与轴名收进留白之内，不写 echarts 6 上作废了的那个键', () => {
    const grid = cartesianGrid()

    expect(grid).toMatchObject({
      outerBoundsMode: 'same',
      outerBoundsContain: 'all',
    })
    expect('containLabel' in grid).toBe(false)
  })

  it('显式关掉那一档就一个键都不写，交回 echarts 缺省的按画布收', () => {
    const grid = cartesianGrid({ labelsInside: false })

    expect('outerBoundsMode' in grid).toBe(false)
    expect('outerBoundsContain' in grid).toBe(false)
  })
})

describe('categoryAxis', () => {
  it('不给抽稀间隔时不写这个键——写 undefined 与写 0 一样会关掉自动抽稀', () => {
    const axis = categoryAxis(theme(), ['a'])
    const label = axis.axisLabel as Record<string, unknown>

    expect('interval' in label).toBe(false)
  })

  it('给了间隔才写', () => {
    const axis = categoryAxis(theme(), ['a'], { interval: 2 })

    expect(axis.axisLabel).toMatchObject({ interval: 2 })
  })

  it('轴文本色缺省取次要文字色，可逐轴覆盖', () => {
    const axis = categoryAxis(theme({ textMuted: 'muted' }), [], {
      nameColor: 'own',
    })

    expect(axis.axisLabel).toMatchObject({ color: 'muted', fontSize: 11 })
    expect(axis.nameTextStyle).toMatchObject({ color: 'own' })
  })
})

describe('valueAxis', () => {
  it('splitLine 关掉时只写 show:false', () => {
    expect(valueAxis(theme(), { splitLine: false }).splitLine).toEqual({
      show: false,
    })
  })

  it('默认画分隔线，颜色取主题', () => {
    expect(valueAxis(theme({ splitLine: 'line' })).splitLine).toEqual({
      lineStyle: { color: 'line' },
    })
  })

  it('scale 透传——高基线上的窄幅波动只有它能看出来', () => {
    expect(valueAxis(theme(), { scale: true }).scale).toBe(true)
  })
})

describe('dataLabel', () => {
  it('缺省显示在顶端、取次要文字色', () => {
    expect(dataLabel(theme({ textMuted: 'muted' }))).toMatchObject({
      show: true,
      position: 'top',
      fontSize: 11,
      color: 'muted',
    })
  })

  it('不给字体时不写这个键，继承 echarts 默认', () => {
    expect('fontFamily' in dataLabel(theme())).toBe(false)
  })

  it('hideZero 只吞真实 0，缺值仍然显「—」', () => {
    const label = dataLabel(theme(), { hideZero: true })
    const format = label.formatter as (p: { value: unknown }) => string

    expect(format({ value: 0 })).toBe('')
    expect(format({ value: '0.00' })).toBe('')
    expect(format({ value: null })).toBe('—')
    expect(format({ value: 3 })).toBe('3')
  })

  it('hideZero 包在自定义 formatter 外面', () => {
    const label = dataLabel(theme(), {
      hideZero: true,
      formatter: (p) => `[${String(p.value)}]`,
    })
    const format = label.formatter as (p: { value: unknown }) => string

    expect(format({ value: 0 })).toBe('')
    expect(format({ value: 3 })).toBe('[3]')
  })

  it('不开 hideZero 时 formatter 连引用都不换', () => {
    const formatter = (p: { value: unknown }) => String(p.value)

    expect(dataLabel(theme(), { formatter }).formatter).toBe(formatter)
  })
})

describe('linearGradient', () => {
  it('竖向渐变自上而下', () => {
    expect(
      linearGradient([
        [0, 'a'],
        [1, 'b'],
      ]),
    ).toEqual({
      type: 'linear',
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: 'a' },
        { offset: 1, color: 'b' },
      ],
      global: false,
    })
  })

  it('横向渐变自左而右', () => {
    expect(linearGradient([], 'h')).toMatchObject({ x2: 1, y2: 0 })
  })
})

describe('areaFade', () => {
  it('由主色派生上浓下透', () => {
    expect(areaFade('#000000', 0.5)).toMatchObject({
      colorStops: [
        { offset: 0, color: 'rgba(0, 0, 0, 0.5)' },
        { offset: 1, color: 'rgba(0, 0, 0, 0)' },
      ],
    })
  })

  it('主色解析不了时退到「主色 → 透明」，两端不会同色画成实心', () => {
    expect(areaFade('hsl(200 50% 50%)')).toMatchObject({
      colorStops: [
        { offset: 0, color: 'hsl(200 50% 50%)' },
        { offset: 1, color: 'transparent' },
      ],
    })
  })

  it('缺色给 undefined，调用方据此省掉整个 areaStyle', () => {
    expect(areaFade('')).toBeUndefined()
  })
})

describe('markLineRef', () => {
  it('单条也收，画成绑值轴的水平线', () => {
    const mark = markLineRef(theme({ accent: 'accent' }), { value: 1013.25 })

    expect(mark).toMatchObject({ silent: true, symbol: 'none' })
    expect(mark.data).toEqual([
      {
        yAxis: 1013.25,
        label: { show: false },
        lineStyle: { type: 'dashed', color: 'accent' },
      },
    ])
  })

  it('axis:x 画成绑类目轴的垂直线', () => {
    const mark = markLineRef(theme(), [{ value: 3, axis: 'x' }])

    expect(mark.data).toMatchObject([{ xAxis: 3 }])
  })

  it('有文字才画 label，颜色与线型逐条可覆盖', () => {
    const mark = markLineRef(theme({ accent: 'accent' }), [
      { value: 1, label: '基线', color: 'red', lineType: 'solid' },
    ])

    expect(mark.data).toEqual([
      {
        yAxis: 1,
        label: { formatter: '基线', fontSize: 10, color: 'red' },
        lineStyle: { type: 'solid', color: 'red' },
      },
    ])
  })

  it('空数组等价于没配参考线', () => {
    expect(markLineRef(theme(), []).data).toEqual([])
  })
})

describe('dataZoomSlider', () => {
  it('横向时绑 x 轴、只写高度这一档几何', () => {
    const [slider, inside] = dataZoomSlider(theme())

    expect(slider).toMatchObject({
      type: 'slider',
      orient: 'horizontal',
      xAxisIndex: 0,
      start: 0,
      end: 100,
      height: 14,
    })
    expect('width' in (slider ?? {})).toBe(false)
    expect(inside).toMatchObject({ type: 'inside', xAxisIndex: 0 })
  })

  it('纵向时绑 y 轴、只写宽度这一档几何', () => {
    const [slider] = dataZoomSlider(theme(), { orient: 'vertical', start: 20 })

    expect(slider).toMatchObject({ yAxisIndex: 0, width: 14, start: 20 })
    expect('height' in (slider ?? {})).toBe(false)
    expect('bottom' in (slider ?? {})).toBe(false)
  })
})

describe('visualMapContinuous', () => {
  it('色阶缺省取顺序色，diverging 取发散色', () => {
    const palette = theme({ palette: ['p0', 'p1', 'p2', 'p3', 'p4'] })

    expect(visualMapContinuous(palette, { min: 0, max: 1 }).inRange).toEqual({
      color: ['p4', 'p0', 'p1', 'p2', 'p3'],
    })
    expect(
      visualMapContinuous(palette, { min: 0, max: 1, diverging: true }).inRange,
    ).toEqual({ color: ['p0', 'p3'] })
  })

  it('调用方给了色阶就用它', () => {
    const map = visualMapContinuous(theme(), {
      min: 0,
      max: 1,
      colors: ['a', 'b'],
    })

    expect(map.inRange).toEqual({ color: ['a', 'b'] })
  })

  it('一个色都派生不出来时不写 inRange，交回 echarts 默认', () => {
    expect(visualMapContinuous(theme(), { min: 0, max: 1 }).inRange).toBe(
      undefined,
    )
  })

  it('给了 top 就不再兜底 bottom', () => {
    expect(
      visualMapContinuous(theme(), { min: 0, max: 1, top: 4 }),
    ).toMatchObject({ top: 4, bottom: undefined })
  })
})

describe('animationOpts', () => {
  it('缺省关：实时刷新不该带滑动与形变', () => {
    expect(animationOpts({})).toEqual({
      animation: false,
      animationDuration: 600,
      animationEasing: 'cubicOut',
    })
  })

  it('只有真的 true 才算开', () => {
    expect(animationOpts({ animation: 'true' }).animation).toBe(false)
    expect(animationOpts({ animation: true }).animation).toBe(true)
  })

  it('时长非法时走 600，不许被 Number() 化成 0 变瞬时', () => {
    expect(animationOpts({ animationDuration: null }).animationDuration).toBe(
      600,
    )
    expect(animationOpts({ animationDuration: -5 }).animationDuration).toBe(600)
    expect(animationOpts({ animationDuration: 0 }).animationDuration).toBe(0)
  })
})

describe('resolvePalette', () => {
  it('自定义色板逐行解析 var(--x)', () => {
    const resolve = vi.fn(() => 'red')
    const config = { palette: [{ color: 'var(--accent-primary)' }] }

    expect(resolvePalette(config, theme({ palette: ['t'] }), resolve)).toEqual([
      'red',
    ])
  })

  it('一行有效色都没有时回退主题色板', () => {
    const config = { palette: [{ color: '' }, {}, 'not a row'] }

    expect(resolvePalette(config, theme({ palette: ['t'] }), () => '')).toEqual(
      ['t'],
    )
  })

  it('没配色板时回退主题色板', () => {
    expect(resolvePalette({}, theme({ palette: ['t'] }), () => '')).toEqual([
      't',
    ])
  })
})

describe('textFactory', () => {
  it('把单位与小数位绑进同一个取值器', () => {
    const format = textFactory({ unit: 'kW', precision: 1 })

    expect(format(1.26)).toBe('1.3kW')
    expect(format(null)).toBe('—')
  })

  it('没配时最多两位、不带单位', () => {
    expect(textFactory({})(1.239)).toBe('1.24')
  })
})

describe('TRANSPARENT_BG', () => {
  it('图表本体透明——卡片框背景由宿主提供', () => {
    expect(TRANSPARENT_BG).toEqual({ backgroundColor: 'transparent' })
  })
})
