/**
 * @fileoverview 契约：时间带元件挂载后的样子——占用条、断档的交叉散列、
 * 请求区间与实际区间并排、行序轴、图例与图下那几行结论。
 *
 * ⚠ 「颜色不作唯一编码」是可测的：断档除了灰还必须有交叉散列（一个 pattern
 * 填充），随机打乱的段除了警示色还必须有散列——这两条只有在这里钉得住。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TimelineBand from '@/pages/Modeling/Canvas/components/TimelineBand.vue'

/** ⚠ 用本地时构造：断言的字面量才不随跑用例的机器时区变。 */
function at(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime()
}

const COVERED = [
  {
    name: '实际取到',
    segments: [
      {
        since: at(2026, 1, 2),
        until: at(2026, 1, 4),
        label: '有数据',
        tone: 'primary' as const,
      },
      {
        since: at(2026, 1, 6),
        until: at(2026, 1, 8),
        label: '有数据',
        tone: 'primary' as const,
      },
    ],
    showGaps: true,
  },
]

describe('时间带元件', () => {
  it('一行都没有时照实说一句，不画一张空框', () => {
    const wrapper = mount(TimelineBand, { props: { rows: [] } })

    expect(wrapper.find('.dt-ml-band__blank').text()).toBe(
      '这一步没有可画的时间段',
    )
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('占用条一段一根，每根挂着起止的 tooltip', () => {
    const wrapper = mount(TimelineBand, { props: { rows: COVERED } })

    const bars = wrapper.findAll('.dt-ml-band__bar--primary')
    expect(bars).toHaveLength(2)
    expect(bars[0]?.find('title').text()).toBe(
      '有数据：2026-01-02 00:00 ~ 2026-01-04 00:00',
    )
  })

  it('断档铺交叉散列，颜色不是唯一区分', () => {
    const wrapper = mount(TimelineBand, { props: { rows: COVERED } })

    const gaps = wrapper.findAll('.dt-ml-band__bar--gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.attributes('fill')).toMatch(/^url\(#dt-ml-band-.+-gap\)$/)
    expect(wrapper.find('.dt-ml-band__hatch--gap').exists()).toBe(true)
  })

  it('随机打乱的那一段也铺散列，把泄漏画成一眼可见的交叉', () => {
    const wrapper = mount(TimelineBand, {
      props: {
        rows: [
          {
            name: '切分',
            segments: [
              {
                since: at(2026, 1, 1),
                until: at(2026, 1, 7),
                label: '训练段',
                tone: 'primary' as const,
              },
              {
                since: at(2026, 1, 7),
                until: at(2026, 1, 9),
                label: '测试段',
                tone: 'shuffled' as const,
              },
            ],
          },
        ],
      },
    })

    const shuffled = wrapper.find('.dt-ml-band__bar--shuffled')
    expect(shuffled.attributes('fill')).toMatch(
      /^url\(#dt-ml-band-.+-shuffled\)$/,
    )
  })

  it('请求区间那一行走空心档，与实际那一行并排', () => {
    const wrapper = mount(TimelineBand, {
      props: {
        span: { low: at(2026, 1, 1), high: at(2026, 1, 9) },
        rows: [
          {
            name: '请求区间',
            segments: [
              {
                since: at(2026, 1, 1),
                until: at(2026, 1, 9),
                label: '请求',
                tone: 'requested' as const,
              },
            ],
          },
          ...COVERED,
        ],
      },
    })

    expect(wrapper.find('.dt-ml-band__bar--requested').exists()).toBe(true)
    expect(wrapper.findAll('.dt-ml-band__lane')).toHaveLength(2)
  })

  it('行名截断显示，整名留在 tooltip 里', () => {
    const wrapper = mount(TimelineBand, {
      props: {
        rows: [
          {
            name: '一个特别长的行名字',
            segments: [
              {
                since: at(2026, 1, 1),
                until: at(2026, 1, 2),
                label: '有数据',
                tone: 'primary' as const,
              },
            ],
          },
        ],
      },
    })

    const name = wrapper.find('.dt-ml-band__name')
    expect(name.text()).toContain('一个特别长的行…')
    expect(name.find('title').text()).toBe('一个特别长的行名字')
  })

  it('图下把时区口径与断档账都写出来', () => {
    const wrapper = mount(TimelineBand, { props: { rows: COVERED } })

    expect(wrapper.find('.dt-ml-band__summary').text()).toBe(
      '轴上 2026-01-02 00:00 ~ 2026-01-08 00:00（本机时区）',
    )
    expect(wrapper.text()).toContain('实际取到：覆盖 66.7%，1 段断档')
  })

  it('图例只列出现过的那几档，并各带一个色块', () => {
    const wrapper = mount(TimelineBand, { props: { rows: COVERED } })

    const items = wrapper.findAll('.dt-ml-band__legend li')
    expect(items).toHaveLength(2)
    expect(items[0]?.text()).toBe('有数据')
    expect(items[1]?.text()).toBe('断档')
  })

  it('行序轴按行号写刻度，不写成时刻', () => {
    const wrapper = mount(TimelineBand, {
      props: {
        scale: 'index',
        rows: [
          {
            name: '折 1',
            segments: [
              {
                since: 0,
                until: 800,
                label: '训练段',
                tone: 'primary' as const,
              },
              {
                since: 800,
                until: 1000,
                label: '测试段',
                tone: 'secondary' as const,
              },
            ],
          },
        ],
      },
    })

    expect(wrapper.find('.dt-ml-band__summary').text()).toBe(
      '轴上 第 0 行 ~ 第 1,000 行',
    )
    expect(wrapper.find('.dt-ml-band__bar--secondary').exists()).toBe(true)
  })

  it('调用方给的一行说明也印出来', () => {
    const wrapper = mount(TimelineBand, {
      props: { rows: COVERED, note: '窗口含当前行' },
    })

    expect(wrapper.text()).toContain('窗口含当前行')
  })
})
