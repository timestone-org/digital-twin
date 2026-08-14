/**
 * @fileoverview 锁住 tooltip 的转义契约（testing-standard-typescript §7.1）。
 * ⚠ echarts 的 tooltip 默认按 HTML 渲染：系列名与量纲是外部数据，一旦拼进
 * HTML 字符串就是注入点，所以这里断言标记只以文本落地、不产生元素。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTooltipFormatter } from '../../../src/shared/chart/tooltip'
import type { DtChartSeries } from '../../../src/shared/chart/series'

const SHANGHAI = 'Asia/Shanghai'
const STAMP = Date.UTC(2026, 7, 12, 2, 55)

function series(name: string, unit: string): DtChartSeries {
  return { key: name, name, unit, axis: 'temperature', points: [] }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('tooltip formatter', () => {
  it('系列名里的标记只作为文本出现，不生成元素', () => {
    const evil = '<img src=x onerror="alert(1)">车间温度'
    const format = createTooltipFormatter([series(evil, '℃')])
    const node = format([
      { seriesIndex: 0, color: 'red', value: [STAMP, 21.5] },
    ])
    expect(node.querySelector('img')).toBeNull()
    expect(node.innerHTML).not.toContain('<img')
    expect(node.innerHTML).toContain('&lt;img')
    expect(node.textContent).toContain(evil)
  })

  it('量纲里的标记同样只作为文本出现', () => {
    const format = createTooltipFormatter([series('温度', '<script>℃')])
    const node = format([{ seriesIndex: 0, value: [STAMP, 1] }])
    expect(node.querySelector('script')).toBeNull()
    expect(node.textContent).toContain('<script>℃')
  })

  it('表头是这一刻的本地时', () => {
    vi.stubEnv('TZ', SHANGHAI)
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ seriesIndex: 0, value: [STAMP, 21.5] }])
    expect(node.textContent).toContain('2026-08-12 10:55')
  })

  it('读数带量纲', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ seriesIndex: 0, value: [STAMP, 21.5] }])
    expect(node.textContent).toContain('温度 21.5℃')
  })

  it('null 读数显示成断档符而不是 0', () => {
    const format = createTooltipFormatter([series('风机频率', 'Hz')])
    const node = format([{ seriesIndex: 0, value: [STAMP, null] }])
    expect(node.textContent).toContain('风机频率 —')
    expect(node.textContent).not.toContain('0Hz')
  })

  it('色点取 echarts 已解析的系列色', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([
      { seriesIndex: 0, color: 'rgb(0, 206, 252)', value: [STAMP, 1] },
    ])
    const dot = node.querySelector('span')
    expect(dot?.style.color).toBe('rgb(0, 206, 252)')
  })

  it('没给系列色时不写死一个颜色，交给继承', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ seriesIndex: 0, value: [STAMP, 1] }])
    expect(node.querySelector('span')?.style.color).toBe('inherit')
  })

  it('下标对不上任何系列时照样出行，不抛错', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ seriesIndex: 9, value: [STAMP, 3] }])
    expect(node.textContent).toContain('3')
  })

  it('压根没给下标时同样出行，不去误取第一条系列的名字', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ value: [STAMP, 3] }])
    expect(node.textContent).toContain('3')
    expect(node.textContent).not.toContain('温度')
  })

  it('value 不是 [时刻, 取值] 形状时按没有取值处理', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ seriesIndex: 0, value: 21.5 }])
    expect(node.textContent).toContain('温度 —')
  })

  it('取值位不是数字时按没有取值处理', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([{ seriesIndex: 0, value: [STAMP, '21.5'] }])
    expect(node.textContent).toContain('温度 —')
  })

  it('一次悬停命中多条系列就出多行', () => {
    const format = createTooltipFormatter([
      series('温度', '℃'),
      series('湿度', '%'),
    ])
    const node = format([
      { seriesIndex: 0, value: [STAMP, 21.5] },
      { seriesIndex: 1, value: [STAMP, 55] },
    ])
    expect(node.children).toHaveLength(3)
  })

  it('一条都没命中时只有一个空表头', () => {
    const format = createTooltipFormatter([series('温度', '℃')])
    const node = format([])
    expect(node.textContent).toBe('')
  })
})
