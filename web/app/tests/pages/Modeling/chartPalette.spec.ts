/**
 * @fileoverview 契约：六个图元件的配色口径——参考几何的笔色、阈值线、系列色的
 * 顺序，以及三处只有挂载才看得见的第二重编码（次色段缩一圈、无名线换点线、
 * 热力格的格线）。
 *
 * ⚠ 这些口径全活在 scoped SCSS 里，happy-dom 不套用样式，只能扫源码文本；扫之
 * 前必须先把注释剥掉，否则注释里写着的令牌名会把断言骗过去。
 * ⚠ 数字都是全部内置预设逐套实测来的：`--border-strong` 压在浅色面板底上只有
 * 1.38:1、`--state-warning` 最低只有 2.08:1，都不到 WCAG 1.4.11 要求的 3:1；
 * 换用的 `--text-secondary` 最低 5.67:1、`--text-disabled` 最低 4.61:1。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import HistogramChart from '@/pages/Modeling/Canvas/components/HistogramChart.vue'
import MatrixTable from '@/pages/Modeling/Canvas/components/MatrixTable.vue'
import TimelineBand from '@/pages/Modeling/Canvas/components/TimelineBand.vue'

/** 五个吃参考几何的图元件。 */
const PARTS = [
  'BarList',
  'HistogramChart',
  'MatrixTable',
  'ScatterPlot',
  'TimelineBand',
] as const

/** 只留代码，注释一律剥掉：注释里的令牌名会把 `toContain` 骗过去。 */
function codeOf(part: string): string {
  const text = readFileSync(
    join(process.cwd(), `app/src/pages/Modeling/Canvas/components/${part}.vue`),
    'utf8',
  )
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 空白折成一个空格，好按整段声明比对。 */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ')
}

describe('参考几何的笔色', () => {
  it.each(PARTS)('%s 一处都不再用 --border-strong', (part) => {
    expect(codeOf(part)).not.toContain('--border-strong')
  })

  it('散点的理想对角线与零残差线走高对比度文字色', () => {
    const code = flat(codeOf('ScatterPlot'))

    expect(code).toContain('&__ideal { stroke: var(--text-secondary);')
    expect(code).toContain('&--reference { stroke: var(--text-secondary); }')
  })

  it('直方的正态参考曲线也走同一档', () => {
    expect(flat(codeOf('HistogramChart'))).toContain(
      '&__curve { fill: none; stroke: var(--text-secondary);',
    )
  })

  it('横条的零线是实线且走同一档', () => {
    expect(flat(codeOf('BarList'))).toContain(
      '&__rule--zero { border-left-style: solid; border-left-color: var(--text-secondary); }',
    )
  })

  it.each(['ScatterPlot', 'HistogramChart', 'TimelineBand'] as const)(
    '%s 的坐标轴走正文可读的次要文字色',
    (part) => {
      expect(flat(codeOf(part))).toContain(
        '&__axis { stroke: var(--text-disabled); }',
      )
    },
  )
})

// ⚠ 阈值线原来走 --state-warning：浅色预设下最低 2.08:1，一条画了等于没画的线
describe('阈值线不再走警示色', () => {
  it('散点的阈值线换成更粗更疏的文字色虚线', () => {
    const code = flat(codeOf('ScatterPlot'))

    expect(code).toContain(
      '&--threshold { stroke: var(--text-secondary); stroke-width: 1.8; stroke-dasharray: 8 4; }',
    )
  })

  it('横条的阈值线与它的引线都换成更粗一档的文字色', () => {
    const code = flat(codeOf('BarList'))

    expect(code).toContain(
      '&__mark--threshold::after { border-left-width: 2px; border-left-color: var(--text-secondary); }',
    )
    expect(code).toContain(
      '&__rule--threshold { border-left-width: 2px; border-left-color: var(--text-secondary); }',
    )
  })

  it('直方的软界标记同样不再走警示色，硬界才留危险色', () => {
    const code = flat(codeOf('HistogramChart'))

    expect(code).toContain(
      '&--warning { stroke: var(--text-secondary); stroke-width: 1.8; stroke-dasharray: 8 4; }',
    )
    expect(code).toContain('&--danger { stroke: var(--state-danger);')
  })
})

// ⚠ --accent-primary 与 --state-success 在翡翠绿下 oklch 色相只差 10.7°，两路
// 序列合成后 ΔE 只有 0.033 ≈ 1.6 JND，图上就是两片一样的绿；换成
// --state-warning 之后全部内置预设里最小色相差 46.9°、最小 ΔE 0.143
describe('系列色的第二档不许再是成功色', () => {
  it('散点的 t1 是警示色，t2 才是危险色、t3 才是成功色', () => {
    const code = flat(codeOf('ScatterPlot'))

    expect(code).toContain('&--t1 { fill: rgba(var(--state-warning-rgb), 0.7)')
    expect(code).toContain('&--t2 { fill: rgba(var(--state-danger-rgb), 0.7)')
    expect(code).toContain('&--t3 { fill: rgba(var(--state-success-rgb), 0.7)')
    expect(code).not.toContain('&--t1 { fill: rgba(var(--state-success-rgb)')
  })

  it('时间带的次色也跟着换，图例那块色块同步', () => {
    const code = flat(codeOf('TimelineBand'))

    expect(code).toContain(
      '&--secondary { fill: rgba(var(--state-warning-rgb), 0.65); }',
    )
    expect(code).not.toContain('rgba(var(--state-success-rgb)')
  })
})

describe('两段叠在一行时看得出是两段', () => {
  const OVERLAP = [
    {
      name: '切分',
      segments: [
        { since: 0, until: 60, label: '训练', tone: 'primary' as const },
        { since: 40, until: 100, label: '测试', tone: 'secondary' as const },
      ],
    },
  ]

  it('次色那一段上下各缩一圈，主色从缝里露出来', () => {
    const wrapper = mount(TimelineBand, {
      props: { rows: OVERLAP, scale: 'index' },
    })
    const bars = wrapper.findAll(
      '.dt-ml-band__bar--primary, .dt-ml-band__bar--secondary',
    )
    const main = bars.find((bar) => bar.classes('dt-ml-band__bar--primary'))
    const second = bars.find((bar) => bar.classes('dt-ml-band__bar--secondary'))

    expect(Number(second?.attributes('y'))).toBeGreaterThan(
      Number(main?.attributes('y')),
    )
    expect(Number(second?.attributes('height'))).toBeLessThan(
      Number(main?.attributes('height')),
    )
  })

  it('两档都描一圈中性边，重叠处两条边都在', () => {
    expect(flat(codeOf('TimelineBand'))).toContain(
      '&--primary, &--secondary { stroke: rgba(var(--neutral-fg-rgb), 0.5); stroke-width: 0.6; }',
    )
  })
})

// ⚠ 标签塞不下时线照旧要画（那是真数据），但读者不该看见一条不知道是什么的线
describe('标签被挤掉的那条线', () => {
  const BINS = [{ low: 0, high: 100, count: 10 }]
  const LOW = { at: 50, label: '下界', intent: 'danger' as const }
  const CROWDED = {
    bins: BINS,
    marks: [
      LOW,
      { at: 51, label: '均值', intent: 'info' as const },
      { at: 52, label: '上界', intent: 'danger' as const },
    ],
  }

  it('换成点线，并把名字挂在线上供悬停读出', () => {
    const wrapper = mount(HistogramChart, { props: CROWDED })
    const unnamed = wrapper.findAll('.dt-ml-hist__mark.is-unnamed')

    expect(unnamed).toHaveLength(1)
    expect(unnamed[0]?.find('title').text()).toBe('上界 52')
  })

  it('画得出标签的那几条不许被误判成无名线', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: BINS, marks: [LOW] },
    })

    expect(wrapper.findAll('.dt-ml-hist__mark.is-unnamed')).toHaveLength(0)
    expect(wrapper.find('.dt-ml-hist__mark title').text()).toBe('下界 50')
  })
})

describe('混淆矩阵的格线与列宽', () => {
  const MATRIX = [
    [5, 3],
    [1, 9],
  ]

  it('每格右下角各一道格线', () => {
    expect(flat(codeOf('MatrixTable'))).toContain(
      'box-shadow: inset -1px 0 0 rgba(var(--neutral-fg-rgb), 0.35), inset 0 -1px 0 rgba(var(--neutral-fg-rgb), 0.35);',
    )
  })

  // ⚠ th 上的 max-width 对表格单元格根本不生效，而 table-layout: fixed 在表宽为
  // auto 时也不生效：只有把列宽之和写成表宽，行头与列头才是同一套收口口径
  it('整张表按列宽之和定宽，列数变了跟着变', () => {
    const two = mount(MatrixTable, {
      props: { labels: ['A', 'B'], matrix: MATRIX },
    })
    const three = mount(MatrixTable, {
      props: {
        labels: ['A', 'B', 'C'],
        matrix: [
          [5, 3, 0],
          [1, 9, 2],
          [0, 1, 7],
        ],
      },
    })

    expect(two.find('.dt-ml-matrix__board').attributes('style')).toContain(
      '--matrix-width: 29.5rem',
    )
    expect(three.find('.dt-ml-matrix__board').attributes('style')).toContain(
      '--matrix-width: 35rem',
    )
    expect(flat(codeOf('MatrixTable'))).toContain(
      ':deep(table.dt-table) { width: var(--matrix-width); }',
    )
    expect(codeOf('MatrixTable')).not.toContain('max-width: 8rem;\n    padding')
  })
})
