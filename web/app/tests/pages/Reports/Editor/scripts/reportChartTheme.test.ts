/** @fileoverview 编辑器图表与 Word 原生图表同一口径：类目来自服务端、图例规则、饼图与缺值。 */
import { expect, it } from 'vitest'
import {
  REPORT_PRINT_COLORS,
  chartFrame,
  hasChartData,
  hasLegend,
  reportChartOption,
} from '@/pages/Reports/Editor/scripts/reportChartTheme'
import { paperFontStack } from '@/pages/Reports/Editor/scripts/paperFont'

const LINE = {
  kind: 'line',
  categories: ['2026-01', '2026-02'],
  series: [{ name: '电量', points: [], values: ['1.5', null] }],
}

it('横轴直接使用服务端格式化好的类目，缺值保留断点', () => {
  const option = reportChartOption(LINE, REPORT_PRINT_COLORS)
  expect(option.xAxis).toMatchObject({
    type: 'category',
    data: ['2026-01', '2026-02'],
  })
  expect(option.series).toEqual([
    expect.objectContaining({ type: 'line', data: [1.5, null] }),
  ])
  expect(option.legend).toMatchObject({ show: false })
})

it('多序列与饼图才显示图例，与 Word 一致', () => {
  expect(hasLegend(LINE)).toBe(false)
  expect(hasLegend({ ...LINE, series: [...LINE.series, ...LINE.series] })).toBe(
    true,
  )
  expect(hasLegend({ kind: 'pie', series: LINE.series })).toBe(true)
})

it('饼图只画正值扇区并显示百分比', () => {
  const option = reportChartOption(
    {
      kind: 'pie',
      categories: ['电', '水', '气'],
      series: [{ name: '构成', points: [], values: ['3', null, '-1'] }],
    },
    REPORT_PRINT_COLORS,
  )
  expect(option.series).toEqual([
    expect.objectContaining({
      type: 'pie',
      data: [{ name: '电', value: 3 }],
      label: expect.objectContaining({ formatter: '{d}%' }),
    }),
  ])
})

it('缺类目的旧回执按时刻并集对齐', () => {
  const frame = chartFrame({
    kind: 'line',
    series: [
      { name: 'a', points: [{ ts: '2026-01-02T00:00:00Z', value: '2' }] },
      { name: 'b', points: [{ ts: '2026-01-01T00:00:00Z', value: '1' }] },
    ],
  })
  expect(frame.categories).toEqual([
    '2026-01-01T00:00:00Z',
    '2026-01-02T00:00:00Z',
  ])
  expect(frame.series.map((item) => item.values)).toEqual([
    [null, 2],
    [1, null],
  ])
  expect(hasChartData({ kind: 'line', series: [] })).toBe(false)
})

it('中文字体名补上系统同款回落，缺省为宋体', () => {
  expect(paperFontStack('')).toBe(
    '"宋体", "SimSun", "Songti SC", "STSong", serif',
  )
  expect(paperFontStack('Arial')).toBe('"Arial", sans-serif')
})
