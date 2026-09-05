/**
 * @fileoverview `bins` 块的画法：分布档一列一张直方图、比率档改走横条，
 * 以及全部退化分支（空 payload / 空箱 / 缺两端 / 触上限 / 极长列名）。
 *
 * ⚠ 夹具照抄后端单测的真实产出（`tests/unit/test_modeling_source_report.py`、
 * `test_modeling_cleaning_report.py`）：手编一份形状会让用例全绿而界面全错。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BinsBlock from '@/pages/Modeling/Canvas/components/BinsBlock.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

function blockOf(
  payload: Record<string, unknown>,
  title = '空的格最多的几列',
): ReportBlock {
  return {
    kind: 'bins',
    zone: 'charts',
    port: 'frame',
    title,
    tier: 1,
    isPrimary: null,
    payload,
  }
}

/** `ledger_source` 的真实产出：两列，各两根柱铺在 0–24 上，一条 danger 线。 */
const SOURCE = blockOf({
  by_column: [
    {
      key: '湿度',
      bins: [8.0, 0.0],
      low: 0.0,
      high: 24.0,
      marks: [{ at: 12.0, label: '一半', intent: 'danger' }],
      off_axis: { label: '空的格', count: 8 },
    },
    {
      key: '温度',
      bins: [0.0, 0.0],
      low: 0.0,
      high: 24.0,
      marks: [{ at: 12.0, label: '一半', intent: 'danger' }],
      off_axis: null,
    },
  ],
})

/** `filter_rows` 的真实产出：40 个箱（触到上限）、阈值线、空值离轴柱。 */
const FILTER_BINS = [
  1,
  ...Array.from({ length: 19 }, () => 0),
  1,
  ...Array.from({ length: 18 }, () => 0),
  1,
]

const FILTER = blockOf(
  {
    by_column: [
      {
        key: '露点',
        bins: FILTER_BINS,
        low: 1.0,
        high: 9.0,
        marks: [{ at: 5.0, label: '阈值', intent: 'danger' }],
        off_axis: { label: '空值（不在这条轴上）', count: 2 },
      },
    ],
  },
  '判据列的分布',
)

/** `drop_missing` 的真实产出：每列一个铺在 0–1 上的空值率，共用一条阈值线。 */
const RATIO_MARK = { at: 0.5, label: '阈值', intent: 'danger' }

const RATIO = blockOf(
  {
    by_column: [
      {
        key: '露点',
        bins: [0.75],
        low: 0,
        high: 1,
        marks: [RATIO_MARK],
        off_axis: null,
      },
      {
        key: '湿度',
        bins: [0.25],
        low: 0,
        high: 1,
        marks: [RATIO_MARK],
        off_axis: null,
      },
    ],
  },
  '各列空值率',
)

/** `cast_type` 的真实产出：同一个分母上的转前转后两个空值率。 */
const PAIRED = blockOf(
  {
    by_column: [
      {
        key: '湿度',
        bins: [0.25, 0.5],
        low: 0.0,
        high: 1.0,
        marks: [],
        off_axis: null,
      },
    ],
  },
  '空值率前后',
)

describe('分布档', () => {
  it('一列一张直方图，柱按两端等宽铺开', () => {
    const wrapper = mount(BinsBlock, { props: { block: SOURCE } })

    expect(wrapper.findAll('.dt-ml-bins__cell')).toHaveLength(2)
    // 8 行落在 0~12 那一箱，另一箱是 0 故不画柱
    expect(wrapper.findAll('.dt-ml-hist__bar-kept')).toHaveLength(1)
    expect(wrapper.find('.dt-ml-hist__bar-kept title').text()).toBe(
      '0 ~ 12：8 行',
    )
  })

  it('块的标题照实印出来', () => {
    const wrapper = mount(BinsBlock, { props: { block: SOURCE } })

    expect(wrapper.find('.dt-ml-bins__title').text()).toBe('空的格最多的几列')
  })

  it('图下那行结论说清轴铺在哪、几个箱、参考线在哪', () => {
    const wrapper = mount(BinsBlock, { props: { block: SOURCE } })

    expect(wrapper.findAll('.dt-ml-bins__note')[0]?.text()).toBe(
      '横轴 0 ~ 24，共 2 个箱；参考线 1 条：一半（12）',
    )
  })

  it('离轴柱照画：因空值落不到轴上的行不许混进桶里', () => {
    const wrapper = mount(BinsBlock, { props: { block: FILTER } })

    expect(wrapper.find('.dt-ml-hist__bar-off').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-hist__summary').text()).toContain(
      '空值（不在这条轴上）：2 行',
    )
  })

  it('箱数触到上限时说清更细的分不出来', () => {
    const wrapper = mount(BinsBlock, { props: { block: FILTER } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '横轴 1 ~ 9，共 40 个箱；参考线 1 条：阈值（5）；箱数已到上限 40，更细的分不出来',
    )
  })

  it('参考线的语义色跟着 intent 走，认不出的落到最轻那一档', () => {
    const unknown = blockOf({
      by_column: [
        {
          key: '露点',
          bins: [1, 2],
          low: 0,
          high: 4,
          marks: [
            { at: 1, label: '下界', intent: 'danger' },
            { at: 3, label: '说不清', intent: '天外来客' },
          ],
          off_axis: null,
        },
      ],
    })
    const wrapper = mount(BinsBlock, { props: { block: unknown } })

    expect(wrapper.find('.dt-ml-hist__mark--danger').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-hist__mark--info').exists()).toBe(true)
  })
})

describe('分布档的退化分支', () => {
  it('payload 整个是空的：照实说没有分布，不画一张空框', () => {
    const wrapper = mount(BinsBlock, { props: { block: blockOf({}) } })

    expect(wrapper.find('.dt-ml-bins__summary').text()).toBe(
      '这一步没有可画的分布。',
    )
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('一列都没有时也不画格子', () => {
    const wrapper = mount(BinsBlock, {
      props: { block: blockOf({ by_column: [] }) },
    })

    expect(wrapper.findAll('.dt-ml-bins__cell')).toHaveLength(0)
  })

  it('两端读不出来时照实说画不出，不拿下标当刻度', () => {
    const noRange = blockOf({
      by_column: [
        { key: '湿度', bins: [3, 4], low: null, high: null, marks: [] },
      ],
    })
    const wrapper = mount(BinsBlock, { props: { block: noRange } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '这一列没给出数轴的两端：有 2 个桶高，却不知道它们横跨哪一段，画不出来',
    )
    expect(wrapper.find('.dt-ml-hist__blank').exists()).toBe(true)
  })

  it('两端与桶高全缺时说的是「没有分布」，不是「不知道横跨哪一段」', () => {
    const nothing = blockOf({
      by_column: [{ key: '湿度', bins: [], low: null, high: null, marks: [] }],
    })
    const wrapper = mount(BinsBlock, { props: { block: nothing } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '这一列没有可画的分布',
    )
  })

  it('有轴没柱时说清一根柱都没有', () => {
    const empty = blockOf({
      by_column: [{ key: '湿度', bins: [], low: 0, high: 9, marks: [] }],
    })
    const wrapper = mount(BinsBlock, { props: { block: empty } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '横轴 0 ~ 9，一根柱都没有',
    )
  })

  it('全零的柱照旧有轴与结论', () => {
    const zeros = blockOf({
      by_column: [{ key: '湿度', bins: [0, 0, 0], low: 0, high: 3, marks: [] }],
    })
    const wrapper = mount(BinsBlock, { props: { block: zeros } })

    expect(wrapper.findAll('.dt-ml-hist__bar-kept')).toHaveLength(0)
    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '横轴 0 ~ 3，共 3 个箱',
    )
  })

  it('两端不是 0–1 的两根柱仍是分布，不许当成空值率', () => {
    // 残差分布铺在 -1 ~ 1 上：柱数少不等于它是一列比率
    const residual = blockOf({
      by_column: [
        {
          key: '残差',
          bins: [4, 6],
          low: -1,
          high: 1,
          marks: [],
          off_axis: null,
        },
      ],
    })
    const wrapper = mount(BinsBlock, { props: { block: residual } })

    expect(wrapper.find('.dt-ml-hist__bar-kept').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-bars__row').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '横轴 -1 ~ 1，共 2 个箱',
    )
  })

  it('只有一列时不摆展开键', () => {
    const wrapper = mount(BinsBlock, { props: { block: FILTER } })

    expect(wrapper.find('.dt-ml-bins__toggle').exists()).toBe(false)
    expect(wrapper.find('.dt-ml-bins__summary').text()).toBe(
      '共 1 列，画了 1 列。',
    )
  })
})

describe('多列与截断', () => {
  const many = blockOf({
    by_column: Array.from({ length: 8 }, (_, seat) => ({
      key: `列${seat}`,
      bins: [seat + 1],
      low: 0,
      high: 10,
      marks: [],
      off_axis: null,
    })),
  })

  it('首屏只画前两列，其余收在展开键后面', () => {
    const wrapper = mount(BinsBlock, { props: { block: many } })

    expect(wrapper.findAll('.dt-ml-bins__cell')).toHaveLength(2)
    expect(wrapper.find('.dt-ml-bins__toggle').text()).toBe(
      '展开另外 6 列的分布',
    )
  })

  it('展开之后八列都画出来', async () => {
    const wrapper = mount(BinsBlock, { props: { block: many } })
    await wrapper.find('.dt-ml-bins__toggle').trigger('click')

    expect(wrapper.findAll('.dt-ml-bins__cell')).toHaveLength(8)
    expect(wrapper.find('.dt-ml-bins__toggle').text()).toBe('收起后面那几列')
  })

  it('列数触到上限时说清可能还有列没画出来', () => {
    const wrapper = mount(BinsBlock, { props: { block: many } })

    expect(wrapper.find('.dt-ml-bins__summary').text()).toBe(
      '共 8 列，画了 2 列。最多只画得下 8 列，这一块已经列满，可能还有列没画出来。',
    )
  })

  it('极长的中文列名收成省略号，全名挂在 tooltip 上', () => {
    const long = '很长的台账列名字第一列很长的台账列名字第二列'
    const wrapper = mount(BinsBlock, {
      props: {
        block: blockOf({
          by_column: [{ key: long, bins: [1, 2], low: 0, high: 10, marks: [] }],
        }),
      },
    })

    expect(wrapper.find('.dt-ml-bins__label').text()).toBe(long)
    expect(
      wrapper.find('.dt-ml-bins__name').attributes('aria-describedby'),
    ).toBeTruthy()
  })
})

describe('比率档', () => {
  it('每列一个铺在 0–1 上的数时改走横条，不画直方图', () => {
    const wrapper = mount(BinsBlock, { props: { block: RATIO } })

    expect(wrapper.findAll('.dt-ml-bars__row')).toHaveLength(2)
    expect(wrapper.find('.dt-ml-hist__summary').exists()).toBe(false)
  })

  it('阈值那条线画成横条上的一条竖线', () => {
    const wrapper = mount(BinsBlock, { props: { block: RATIO } })

    expect(wrapper.find('.dt-ml-bars__rule--threshold').exists()).toBe(true)
    expect(wrapper.find('.dt-ml-bars__mark-text').text()).toBe('阈值')
  })

  it('结论那行点名最高的列，并数清几列越过阈值', () => {
    const wrapper = mount(BinsBlock, { props: { block: RATIO } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '最高的一列是「露点」：75%；阈值 50%，1 列越过了。',
    )
  })

  it('一列都没越过阈值时明说没有，不含糊', () => {
    const safe = blockOf({
      by_column: [
        { key: '露点', bins: [0.25], low: 0, high: 1, marks: [RATIO_MARK] },
      ],
    })
    const wrapper = mount(BinsBlock, { props: { block: safe } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '最高的一列是「露点」：25%；阈值 50%，没有一列越过。',
    )
  })

  it('转前转后两个数走前后对比，读数写成一条', () => {
    const wrapper = mount(BinsBlock, { props: { block: PAIRED } })

    expect(wrapper.find('.dt-ml-bars__num').text()).toBe('0.25 → 0.5')
    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '最高的一列是「湿度」：25% → 50%。',
    )
  })

  it('零行的帧上空值率算不出来：画成「—」而不是 0', () => {
    const blank = blockOf({
      by_column: [{ key: '湿度', bins: [], low: 0.0, high: 1.0, marks: [] }],
    })
    const wrapper = mount(BinsBlock, { props: { block: blank } })

    expect(wrapper.find('.dt-ml-bins__note').text()).toBe(
      '这几列的空值率一个都算不出来（这一步一行都没有），一列都没画。',
    )
    expect(wrapper.find('.dt-ml-bars__num').text()).toBe('—')
  })
})
