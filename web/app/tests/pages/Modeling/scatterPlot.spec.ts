/**
 * @fileoverview 契约：散点元件挂载后的样子——四态各自的参考几何、序列的色档与
 * 标记形状、±σ 带、图例、以及图下那几行字。
 *
 * ⚠ 「颜色不作唯一编码」是可测的：「之前」那一路除了灰还必须空心（`--before`
 * 档），多路序列除了色档还必须有各自的标记形状——这两条只有在这里钉得住。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ScatterPlot from '@/pages/Modeling/Canvas/components/ScatterPlot.vue'

const PAIRS: [number, number][] = [
  [0, 0.2],
  [5, 4.4],
  [10, 9.6],
]

function series(points: readonly (readonly [number, number])[] = PAIRS) {
  return [{ name: '预测值', points }]
}

describe('散点元件', () => {
  it('一路点都没有时照实说一句，不画一张空框', () => {
    const wrapper = mount(ScatterPlot, { props: { series: [] } })

    expect(wrapper.find('.dt-ml-scatter__blank').text()).toBe(
      '这一步没有可画的点',
    )
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('标题与两条轴名都摆出来，图下那行结论也在', () => {
    const wrapper = mount(ScatterPlot, {
      props: {
        series: series(),
        caption: '真值对预测值',
        xLabel: '真值',
        yLabel: '预测值',
      },
    })

    expect(wrapper.find('figcaption').text()).toBe('真值对预测值')
    expect(wrapper.find('.dt-ml-scatter__axis-name').text()).toBe('真值')
    expect(wrapper.find('.dt-ml-scatter__yaxis-name').text()).toBe('预测值')
    expect(wrapper.find('.dt-ml-scatter__summary').text()).toContain(
      '共 3 个点',
    )
  })

  it('pairs 态画一条理想对角线，series 态不画', () => {
    const paired = mount(ScatterPlot, { props: { series: series() } })
    const timed = mount(ScatterPlot, {
      props: { series: series(), mode: 'series' },
    })

    expect(paired.find('.dt-ml-scatter__ideal').exists()).toBe(true)
    expect(timed.find('.dt-ml-scatter__ideal').exists()).toBe(false)
  })

  it('residual 态自带一条零残差线，标签写着取值', () => {
    const wrapper = mount(ScatterPlot, {
      props: { series: series(), mode: 'residual' },
    })

    const rule = wrapper.find('.dt-ml-scatter__rule--reference')
    expect(rule.exists()).toBe(true)
    expect(wrapper.find('.dt-ml-scatter__rules text').text()).toBe('零残差 0')
  })

  it('阈值线与参考线用两种线型，不靠颜色一个人扛', () => {
    const wrapper = mount(ScatterPlot, {
      props: {
        series: series(),
        mode: 'series',
        rules: [{ at: 5, label: '八成', intent: 'threshold' }],
      },
    })

    expect(wrapper.find('.dt-ml-scatter__rule--threshold').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-scatter__rule--reference').exists()).toBe(false)
  })

  it('落在数据之外的参考线改成图下一行字，不画到框外去', () => {
    const wrapper = mount(ScatterPlot, {
      props: {
        series: series(),
        mode: 'series',
        rules: [{ at: 800, label: '八成', intent: 'threshold' }],
      },
    })

    expect(wrapper.find('.dt-ml-scatter__rule--threshold').exists()).toBe(false)
    expect(wrapper.text()).toContain('八成 800 落在这段数据的范围之外')
  })

  it('±σ 带画成一层底 + 一个文字标签', () => {
    const wrapper = mount(ScatterPlot, {
      props: {
        series: series(),
        mode: 'residual',
        band: { low: -1, high: 1, label: '±1σ' },
      },
    })

    expect(wrapper.find('.dt-ml-scatter__band rect').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-scatter__band text').text()).toBe('±1σ')
  })

  it('「之前」那一路走 before 档，图例跟着一起摆', () => {
    const wrapper = mount(ScatterPlot, {
      props: {
        mode: 'series',
        series: [
          { name: '原始', points: PAIRS, isBefore: true, draw: 'dots' },
          { name: '聚合后', points: PAIRS },
        ],
      },
    })

    expect(wrapper.find('.dt-ml-scatter__dots--before').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-scatter__line--t0').exists()).toBe(true)
    expect(wrapper.findAll('.dt-ml-scatter__legend li')).toHaveLength(2)
  })

  it('图例的色块带上各自的标记形状，色档不是唯一区分', () => {
    const wrapper = mount(ScatterPlot, {
      props: {
        mode: 'series',
        series: [
          { name: '甲', points: PAIRS },
          { name: '乙', points: PAIRS },
        ],
      },
    })

    const swatches = wrapper.findAll('.dt-ml-scatter__swatch')
    expect(swatches[0]?.classes()).toContain('dt-ml-scatter__swatch--circle')
    expect(swatches[1]?.classes()).toContain('dt-ml-scatter__swatch--square')
  })

  it('只有一路时不摆图例', () => {
    const wrapper = mount(ScatterPlot, { props: { series: series() } })

    expect(wrapper.find('.dt-ml-scatter__legend').exists()).toBe(false)
  })

  it('超上限时图下写清是等距抽的，不是只画最早那一段', () => {
    const many: [number, number][] = Array.from({ length: 700 }, (_, at) => [
      at,
      at,
    ])
    const wrapper = mount(ScatterPlot, {
      props: { series: [{ name: '残差', points: many }], mode: 'series' },
    })

    expect(wrapper.text()).toContain('等距抽了 500 个')
    expect(wrapper.text()).toContain('原 700 个')
  })

  it('后端削过的点与自己抽的点分两行说，不合并成一句', () => {
    const wrapper = mount(ScatterPlot, {
      props: { series: series(), isTruncated: true, note: '这 200 行来自摘要' },
    })

    expect(wrapper.text()).toContain('点太多，后端只带回来其中一部分')
    expect(wrapper.text()).toContain('这 200 行来自摘要')
  })
})
