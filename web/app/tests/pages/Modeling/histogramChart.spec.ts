/**
 * @fileoverview 直方图元件挂载后的样子：柱、双色分段、离轴柱、参考线、曲线、
 * 图例与图下那行结论。
 *
 * ⚠ 「颜色不作唯一编码」是可测的：丢弃段除了警示色必须还有斜纹（一个 pattern
 * 填充），越界段除了危险色必须还有边框——这两条只有在这里钉得住。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import HistogramChart from '@/pages/Modeling/Canvas/components/HistogramChart.vue'

const BINS = [
  { low: -2, high: -1, count: 3 },
  { low: -1, high: 0, count: 9 },
  { low: 0, high: 1, count: 4 },
]

describe('直方图', () => {
  it('一箱一根柱，每根挂着区间与计数的 tooltip', () => {
    const wrapper = mount(HistogramChart, { props: { bins: BINS } })

    expect(wrapper.findAll('.dt-ml-hist__bar-kept')).toHaveLength(3)
    expect(wrapper.find('title').text()).toBe('-2 ~ -1：3 行')
  })

  it('没有柱也没有离轴柱时照实说一句，不画一张空框', () => {
    const wrapper = mount(HistogramChart, { props: { bins: [] } })

    expect(wrapper.find('.dt-ml-hist__blank').text()).toBe(
      '这一步没有可画的分布',
    )
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('全零计数时不画柱，但轴与结论都在', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: [{ low: 0, high: 1, count: 0 }] },
    })

    expect(wrapper.findAll('.dt-ml-hist__bar-kept')).toHaveLength(0)
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-hist__summary').text()).toBe('轴上共 0 行')
  })

  it('图下那行结论把行数账写清楚', () => {
    const wrapper = mount(HistogramChart, {
      props: {
        bins: [{ low: 0, high: 1, count: 10, dropped: 3 }],
        offAxis: { label: '空值', count: 2891 },
      },
    })

    expect(wrapper.find('.dt-ml-hist__summary').text()).toBe(
      '轴上共 10 行；丢弃 3 行（30%）；空值：2,891 行（不在这条轴上）',
    )
  })
})

describe('保留与丢弃两段', () => {
  const DROPPED = [{ low: 0, high: 1, count: 10, dropped: 4 }]

  it('丢弃段除了警示色还有斜纹，不靠颜色单独编码', () => {
    const wrapper = mount(HistogramChart, { props: { bins: DROPPED } })
    const bar = wrapper.find('.dt-ml-hist__bar-dropped')

    expect(bar.attributes('fill')).toMatch(/^url\(#.+-warning\)$/)
    expect(wrapper.find('.dt-ml-hist__hatch-line').exists()).toBe(true)
  })

  it('越界段改危险色时除了颜色还有 1px 边框', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: DROPPED, dropIntent: 'danger' },
    })
    const bar = wrapper.find('.dt-ml-hist__bar-dropped')

    expect(bar.classes()).toContain('dt-ml-hist__bar-dropped--danger')
    expect(bar.attributes('fill')).toMatch(/^url\(#.+-danger\)$/)
  })

  it('有丢弃段才摆图例，两段各叫什么由调用方定', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: DROPPED, keptLabel: '留下', droppedLabel: '被裁剪' },
    })

    expect(wrapper.find('.dt-ml-hist__legend').text()).toContain('留下')
    expect(wrapper.find('.dt-ml-hist__legend').text()).toContain('被裁剪')
  })

  it('一行都没丢时不摆图例', () => {
    const wrapper = mount(HistogramChart, { props: { bins: BINS } })

    expect(wrapper.find('.dt-ml-hist__legend').exists()).toBe(false)
  })

  // ⚠ 一屏挂好几张图时 pattern 的 id 撞了，后一张会引到前一张的斜纹
  it('同一屏上两张图的斜纹各用各的 id', () => {
    const pair = defineComponent({
      setup: () => () =>
        h('div', [
          h(HistogramChart, { bins: DROPPED }),
          h(HistogramChart, { bins: DROPPED }),
        ]),
    })
    const wrapper = mount(pair)
    const ids = wrapper.findAll('pattern').map((it) => it.attributes('id'))

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('参考竖线', () => {
  it('范围之内的画成虚线并带文字标签', () => {
    const wrapper = mount(HistogramChart, {
      props: {
        bins: BINS,
        marks: [{ at: 0, label: '零误差', intent: 'warning' }],
      },
    })

    expect(wrapper.findAll('.dt-ml-hist__mark')).toHaveLength(1)
    expect(wrapper.find('.dt-ml-hist__mark').classes()).toContain(
      'dt-ml-hist__mark--warning',
    )
    expect(wrapper.find('.dt-ml-hist__mark-label').text()).toBe('零误差 0')
  })

  it('多条线各按自己的档位上色', () => {
    const wrapper = mount(HistogramChart, {
      props: {
        bins: BINS,
        marks: [
          { at: -1.5, label: '下界', intent: 'danger' },
          { at: 0.5, label: '上界', intent: 'danger' },
        ],
      },
    })

    expect(wrapper.findAll('.dt-ml-hist__mark--danger')).toHaveLength(2)
  })

  it('落在数据之外的线不画，改成图下一行字', () => {
    const wrapper = mount(HistogramChart, {
      props: {
        bins: [{ low: 1, high: 2, count: 5 }],
        marks: [{ at: 12.5, label: '阈值', intent: 'danger' }],
      },
    })

    expect(wrapper.findAll('.dt-ml-hist__mark')).toHaveLength(0)
    expect(wrapper.find('.dt-ml-hist__stray').text()).toBe(
      '阈值 12.5 落在这段数据的范围之外，没有画出来',
    )
  })
})

describe('离轴柱与曲线', () => {
  it('离轴柱画在轴外并标明它不在轴上', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: BINS, offAxis: { label: '空值', count: 2891 } },
    })

    expect(wrapper.find('.dt-ml-hist__bar-off').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-hist__off').text()).toContain('不在轴上')
    expect(wrapper.find('.dt-ml-hist__bar-off title').text()).toBe(
      '空值：2,891 行（不在这条轴上）',
    )
  })

  it('没有离轴柱时那一栏整个不摆', () => {
    const wrapper = mount(HistogramChart, { props: { bins: BINS } })

    expect(wrapper.find('.dt-ml-hist__off').exists()).toBe(false)
  })

  it('给了均值与离散度就叠一条正态参考曲线', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: BINS, curve: { mean: -0.5, sd: 1 } },
    })

    expect(wrapper.find('.dt-ml-hist__curve').exists()).toBe(true)
  })

  it('离散度为 0 时不画曲线', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: BINS, curve: { mean: 0, sd: 0 } },
    })

    expect(wrapper.find('.dt-ml-hist__curve').exists()).toBe(false)
  })
})

describe('轴与标题', () => {
  it('标题写在图上，也做成图的无障碍名', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: BINS, caption: '残差分布' },
    })

    expect(wrapper.find('figcaption').text()).toBe('残差分布')
    expect(wrapper.find('svg').attributes('aria-label')).toBe('残差分布')
  })

  it('没给标题时无障碍名有兜底，不是空串', () => {
    const wrapper = mount(HistogramChart, { props: { bins: BINS } })

    expect(wrapper.find('figcaption').exists()).toBe(false)
    expect(wrapper.find('svg').attributes('aria-label')).toBe('分布直方图')
  })

  it('两根轴都有刻度数字，轴名摆在横轴下面', () => {
    const wrapper = mount(HistogramChart, {
      props: { bins: BINS, axisLabel: '残差' },
    })

    expect(wrapper.findAll('.dt-ml-hist__xlabels text').length).toBeGreaterThan(
      1,
    )
    expect(wrapper.findAll('.dt-ml-hist__grid text').length).toBeGreaterThan(1)
    expect(wrapper.find('.dt-ml-hist__axis-name').text()).toBe('残差')
  })

  // ⚠ 轴名与离轴柱那两行字挨在同一条基线上时左右只差几个像素，连起来读像一句话
  it('轴名与离轴柱的说明各占一行，不压在同一条基线上', () => {
    const wrapper = mount(HistogramChart, {
      props: {
        bins: BINS,
        axisLabel: '冷冻水泵出口温度 (°C)',
        offAxis: { label: '空值', count: 12 },
      },
    })
    const lines = [
      wrapper.find('.dt-ml-hist__axis-name'),
      ...wrapper.findAll('.dt-ml-hist__off text'),
    ].map((line) => line.attributes('y'))

    expect(lines).toHaveLength(3)
    expect(new Set(lines).size).toBe(lines.length)
  })
})
