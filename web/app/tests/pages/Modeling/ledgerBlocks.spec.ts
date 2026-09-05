/**
 * @fileoverview 三种账画出来的样子：漏斗分两条轴、名单可折叠、格子带原值样例，
 * 以及图下那一行可见的文字结论（规格 §2-P6）。
 *
 * ⚠ 夹具照抄后端真实产出：手编一份形状的话，用例全绿而界面全错。
 * ⚠ 断言里带具体数字：只钉「有几个条」的用例，把 5 行画成 50 行也照样绿。
 */
import { DtNotice, DtTooltip } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BarList from '@/pages/Modeling/Canvas/components/BarList.vue'
import CellsBlock from '@/pages/Modeling/Canvas/components/CellsBlock.vue'
import ColumnsBlock from '@/pages/Modeling/Canvas/components/ColumnsBlock.vue'
import RowsBlock from '@/pages/Modeling/Canvas/components/RowsBlock.vue'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

const LONG_NAME = '1#冷冻水泵出口温度与回水温度的差值折算后的读数'

function blockOf(
  kind: string,
  title: string,
  payload: Record<string, unknown>,
): ReportBlock {
  return {
    kind,
    zone: 'step',
    port: 'frame',
    title,
    tier: 0,
    isPrimary: null,
    payload,
  }
}

// `ledger_source` 真实产出：前三级数的是列、后三级数的是行
const SOURCE = blockOf('rows', '取数漏斗', {
  before: 5,
  after: 5,
  dropped: 0,
  dropped_blank: 0,
  ratio_configured: null,
  ratio_actual: null,
  funnel: [
    {
      name: '台账列数',
      value: null,
      unit: '列',
      note: '只取了其中几列，台账当前一共几列这里看不到',
    },
    { name: '选中', value: 3, unit: '列', note: '' },
    { name: '丢空列后', value: 2, unit: '列', note: '' },
    { name: '窗口命中', value: 5, unit: '行', note: '' },
    { name: '行数上限', value: 50000, unit: '行', note: '' },
    { name: '实取', value: 5, unit: '行', note: '' },
  ],
  by_column: [],
})

// `drop_missing` 真实产出
const HOLED = blockOf('rows', '丢缺失', {
  before: 5,
  after: 2,
  dropped: 3,
  dropped_blank: 1,
  ratio_configured: null,
  ratio_actual: 0.4,
  funnel: [
    { name: '进来', value: 5, unit: '行', note: '' },
    {
      name: '被判缺失',
      value: 3,
      unit: '行',
      note: '判据列里有一个空就丢这行',
    },
    { name: '留下', value: 2, unit: '行', note: '' },
  ],
  by_column: [
    { key: '湿度', count: 2, ratio: 0.666667 },
    { key: '露点', count: 2, ratio: 0.666667 },
  ],
})

// `split_dataset` 真实产出：两个比例不一样
const SPLIT = blockOf('rows', '切分的账', {
  before: 10,
  after: 10,
  dropped: 0,
  dropped_blank: 0,
  ratio_configured: 0.05,
  ratio_actual: 0.1,
  funnel: [
    { name: '切分前', value: 10, unit: '行', note: '' },
    { name: '训练集', value: 9, unit: '行', note: '' },
    { name: '测试集', value: 1, unit: '行', note: '' },
  ],
  by_column: [],
  notes: ['两路来自同一次取数，切分不改出处'],
})

// `rolling_feature` 真实产出：没有漏斗，只有逐列的头部空行，且挂着告警
const ROLLING = blockOf('rows', '空掉的行', {
  before: 5,
  after: 5,
  dropped: 0,
  dropped_blank: 0,
  ratio_configured: null,
  ratio_actual: null,
  funnel: [],
  by_column: [{ key: '露点@mean2', count: 1, ratio: 0.2, head: 1, empty: 0 }],
  notes: [
    { level: 'hint', text: '开头那几行是空值不是 0' },
    { level: 'alert', text: '窗口里的空值先被滤掉再折，所以分母逐行不同' },
  ],
})

// `one_hot` 真实产出
const ONE_HOT = blockOf('columns', '列 diff', {
  added: ['机组=甲', '机组=丙', '机组=乙'],
  removed: ['机组'],
  kept: 3,
  dtype_before: [],
  reason: '1 列编成 3 个 0/1 列',
})

// `cast_type` 真实产出：只换类型
const CAST_COLUMNS = blockOf('columns', '类型对照', {
  added: [],
  removed: [],
  kept: 2,
  dtype_before: [{ key: '湿度', before: 'string', after: 'number' }],
  reason: '1 列转成数值，转不动的当成空值放过',
})

// `select_feature` 真实产出：这一步静默退化了
const SELECT = blockOf('columns', '保留与淘汰', {
  added: [],
  removed: ['湿度'],
  kept: 1,
  dtype_before: [],
  reason: '在 5 行训练行上按方差给 2 个候选列打分，留下前 1 列',
  degraded: true,
  degraded_reason: '图里下游的切分不是恰好一个，这一步于是在整帧上排名',
  notes: ['方差对量纲敏感，单位大的列方差天然大'],
})

// `cast_type` 真实产出：转不动的格连原值一起带回来
const CAST_CELLS = blockOf('cells', '转不动的格', {
  by_column: [
    { key: '湿度', changed: 2, low: null, high: null, samples: ['--', 'n/a'] },
  ],
})

// `fill_missing` 真实产出：只有格数，没有区间也没有样例
const FILL = blockOf('cells', '填了多少格', {
  by_column: [{ key: '露点', changed: 2, low: null, high: null, samples: [] }],
})

// `clip_outlier` 真实产出：夹它的那两个数与被夹掉的原值
const CLIP = blockOf('cells', '夹了多少格', {
  by_column: [
    { key: '露点', changed: 1, low: -10.25, high: 21.25, samples: [100.0] },
  ],
})

describe('行数的账', () => {
  it('列的三级与行的三级各占一条轴，量级差一万倍也读得出', () => {
    const wrapper = mount(RowsBlock, { props: { block: SOURCE } })
    const bars = wrapper.findAllComponents(BarList)

    expect(bars).toHaveLength(2)
    expect(bars[0]?.props('unit')).toBe('列')
    expect(bars[1]?.props('unit')).toBe('行')
    expect(wrapper.text()).toContain('按列数')
    expect(wrapper.text()).toContain('按行数')
  })

  it('拿不到的那一级印成「—」并把原因摆在图下', () => {
    const wrapper = mount(RowsBlock, { props: { block: SOURCE } })

    expect(wrapper.text()).toContain('—')
    expect(wrapper.text()).toContain(
      '台账列数：只取了其中几列，台账当前一共几列这里看不到',
    )
  })

  it('图下那一行结论把四个数一起说清', () => {
    const wrapper = mount(RowsBlock, { props: { block: HOLED } })

    expect(wrapper.find('.dt-ml-rows__read').text()).toBe(
      '5 行 → 2 行，丢了 3 行（60%），其中 1 行是因为有空值（33.3%），' +
        '按列看最多的是「湿度」：2 行，占丢掉那些行的 66.7%',
    )
  })

  it('归因那张图逐列印行数', () => {
    const wrapper = mount(RowsBlock, { props: { block: HOLED } })
    const blame = wrapper.findAllComponents(BarList).at(-1)

    expect(wrapper.text()).toContain('按列归因')
    expect(blame?.props('unit')).toBe('行')
    expect(blame?.text()).toContain('湿度')
    expect(blame?.text()).toContain('2 行')
  })

  it('配的比例与实际达成的比例两个都印，并说破它们不一样', () => {
    const wrapper = mount(RowsBlock, { props: { block: SPLIT } })
    const text = wrapper.find('.dt-ml-rows__ratios').text()

    expect(text).toContain('配的比例')
    expect(text).toContain('5%')
    expect(text).toContain('实际达成')
    expect(text).toContain('10%')
    expect(wrapper.find('.dt-ml-rows__apart').exists()).toBe(true)
  })

  it('只有实际达成时另一个印成「—」，那一行仍旧两个格子', () => {
    const wrapper = mount(RowsBlock, { props: { block: HOLED } })

    expect(wrapper.find('.dt-ml-rows__ratios').text()).toContain('—')
    expect(wrapper.find('.dt-ml-rows__apart').exists()).toBe(false)
  })

  it('两个比例都没有时整行不出现', () => {
    const wrapper = mount(RowsBlock, { props: { block: SOURCE } })

    expect(wrapper.find('.dt-ml-rows__ratios').exists()).toBe(false)
  })

  it('没有漏斗时至少画出前后两根条', () => {
    const wrapper = mount(RowsBlock, { props: { block: ROLLING } })
    const bars = wrapper.findAllComponents(BarList)

    expect(bars[0]?.props('mode')).toBe('pairs')
    expect(bars[0]?.text()).toContain('5 → 5')
  })

  it('那一级没写单位时不编一个出来，只说这是逐级的账', () => {
    const wrapper = mount(RowsBlock, {
      props: {
        block: blockOf('rows', '逐级', {
          before: 8,
          after: 8,
          funnel: [{ name: '进来', value: 8 }],
        }),
      },
    })

    expect(wrapper.find('.dt-ml-rows__label').text()).toBe('逐级')
    expect(wrapper.findComponent(BarList).props('unit')).toBe('')
  })

  it('告警整条摆出来，口径说明摆在图下', () => {
    const wrapper = mount(RowsBlock, { props: { block: ROLLING } })

    expect(wrapper.findComponent(DtNotice).text()).toContain(
      '窗口里的空值先被滤掉再折',
    )
    expect(wrapper.text()).toContain('开头那几行是空值不是 0')
  })

  it('payload 整个读不出来时退化成 0 行 → 0 行，不是白屏', () => {
    const wrapper = mount(RowsBlock, {
      props: { block: blockOf('rows', '行数账', {}) },
    })

    expect(wrapper.find('.dt-ml-rows__read').text()).toBe(
      '0 行 → 0 行，一行都没丢',
    )
    expect(wrapper.findAllComponents(BarList)).toHaveLength(1)
  })

  it('逐级账触到上限时说清后面的没带出来', () => {
    const wrapper = mount(RowsBlock, { props: { block: SOURCE } })

    expect(wrapper.text()).toContain('逐级账已经列到上限 6 级')
  })

  it('按列归因触到上限时说清摊得少的没带出来', () => {
    const many = Array.from({ length: 12 }, (_, seat) => ({
      key: `列${seat}`,
      count: 12 - seat,
      ratio: null,
    }))
    const wrapper = mount(RowsBlock, {
      props: {
        block: blockOf('rows', '丢缺失', {
          before: 20,
          after: 8,
          dropped: 12,
          by_column: many,
        }),
      },
    })

    expect(wrapper.text()).toContain('按列归因已经列到上限 12 列')
  })
})

describe('列的账', () => {
  it('新增与移除两组名单各自成组，名单里是真的列名', () => {
    const wrapper = mount(ColumnsBlock, { props: { block: ONE_HOT } })
    const lists = wrapper.findAll('.dt-ml-cols__list')

    expect(lists).toHaveLength(2)
    expect(lists[0]?.text()).toContain('新增 3 列')
    expect(lists[0]?.text()).toContain('机组=甲')
    expect(lists[1]?.text()).toContain('移除 1 列')
  })

  it('这一步为什么动列的那句话一个字不改地印出来', () => {
    const wrapper = mount(ColumnsBlock, { props: { block: SELECT } })

    expect(wrapper.find('.dt-ml-cols__reason').text()).toBe(
      '在 5 行训练行上按方差给 2 个候选列打分，留下前 1 列',
    )
  })

  it('静默退化的那一句整条摆出来', () => {
    const wrapper = mount(ColumnsBlock, { props: { block: SELECT } })

    expect(wrapper.findComponent(DtNotice).text()).toContain(
      '图里下游的切分不是恰好一个',
    )
  })

  it('没退化时那句话一个字都不出现', () => {
    const wrapper = mount(ColumnsBlock, {
      props: {
        block: blockOf('columns', '保留与淘汰', {
          kept: 1,
          degraded: false,
          degraded_reason: '这句不该印',
        }),
      },
    })

    expect(wrapper.text()).not.toContain('这句不该印')
  })

  it('类型对照逐列印出前后两个类型', () => {
    const wrapper = mount(ColumnsBlock, { props: { block: CAST_COLUMNS } })

    expect(wrapper.find('.dt-ml-cols__types').text()).toContain('湿度')
    expect(wrapper.find('.dt-ml-cols__cast').text()).toBe('string → number')
    expect(wrapper.find('.dt-ml-cols__read').text()).toBe(
      '这一步之后一共 2 列：1 列换了类型',
    )
  })

  it('名单短的摊开、长的折起来', () => {
    const many = Array.from({ length: 60 }, (_, seat) => `列${seat}`)
    const wrapper = mount(ColumnsBlock, {
      props: { block: blockOf('columns', '新增列', { added: many, kept: 62 }) },
    })

    expect(wrapper.find('.dt-ml-cols__list').attributes('open')).toBeUndefined()
    expect(
      mount(ColumnsBlock, { props: { block: ONE_HOT } })
        .find('.dt-ml-cols__list')
        .attributes('open'),
    ).toBeDefined()
  })

  it('名单触到上限时说清后面的列名没带出来', () => {
    const many = Array.from({ length: 60 }, (_, seat) => `列${seat}`)
    const wrapper = mount(ColumnsBlock, {
      props: { block: blockOf('columns', '新增列', { added: many, kept: 62 }) },
    })

    expect(wrapper.text()).toContain('名单已经列到上限 60 个')
  })

  it('类型对照触到上限时也说清', () => {
    const many = Array.from({ length: 12 }, (_, seat) => ({
      key: `列${seat}`,
      before: 'string',
      after: 'number',
    }))
    const wrapper = mount(ColumnsBlock, {
      props: {
        block: blockOf('columns', '类型对照', { dtype_before: many, kept: 12 }),
      },
    })

    expect(wrapper.text()).toContain('类型对照已经列到上限 12 列')
  })

  it('长中文列名截断靠版式，全名挂在 DtTooltip 上', () => {
    const wrapper = mount(ColumnsBlock, {
      props: {
        block: blockOf('columns', '新增列', { added: [LONG_NAME], kept: 2 }),
      },
    })

    expect(wrapper.findComponent(DtTooltip).props('content')).toBe(LONG_NAME)
    expect(wrapper.find('.dt-ml-cols__text').text()).toBe(LONG_NAME)
  })

  it('一列都没动时照实说，不摆两组空名单', () => {
    const wrapper = mount(ColumnsBlock, {
      props: { block: blockOf('columns', '列 diff', {}) },
    })

    expect(wrapper.findAll('.dt-ml-cols__list')).toHaveLength(0)
    expect(wrapper.find('.dt-ml-cols__read').text()).toBe(
      '这一步之后一共 0 列：这一步一列都没动',
    )
  })
})

describe('格子的账', () => {
  it('逐列印格数、区间与原值样例', () => {
    const wrapper = mount(CellsBlock, { props: { block: CLIP } })

    expect(wrapper.find('.dt-ml-cells__num').text()).toBe('1 格')
    expect(wrapper.find('.dt-ml-cells__range').text()).toBe('-10.25 ~ 21.25')
    expect(wrapper.find('.dt-ml-cells__samples').text()).toContain('100')
  })

  it('原值里的占位符一个字不改地印出来', () => {
    const wrapper = mount(CellsBlock, { props: { block: CAST_CELLS } })
    const samples = wrapper.find('.dt-ml-cells__samples').text()

    expect(samples).toContain('--')
    expect(samples).toContain('n/a')
  })

  it('不是数值的列不印区间，改说清为什么没有', () => {
    const wrapper = mount(CellsBlock, { props: { block: CAST_CELLS } })

    expect(wrapper.find('.dt-ml-cells__range').text()).toBe(
      '没有区间（这一列不是数值）',
    )
  })

  it('没带回原值样例时明说，不留一行空白', () => {
    const wrapper = mount(CellsBlock, { props: { block: FILL } })

    expect(wrapper.find('.dt-ml-cells__samples').text()).toBe(
      '这一列没有带回原值样例',
    )
  })

  it('原本就是空的那一格印成「（空）」，不是凭空少一个样例', () => {
    const wrapper = mount(CellsBlock, {
      props: {
        block: blockOf('cells', '转不动的格', {
          by_column: [{ key: '湿度', changed: 1, samples: [null] }],
        }),
      },
    })

    expect(wrapper.find('.dt-ml-cells__samples').text()).toContain('（空）')
  })

  it('图下那一行结论说清行数一行没变', () => {
    const wrapper = mount(CellsBlock, { props: { block: CAST_CELLS } })

    expect(wrapper.find('.dt-ml-cells__read').text()).toBe(
      '1 列上一共改了 2 个格子，行数一行都没变；最多的是「湿度」：2 格',
    )
  })

  it('一个格子都没改时给一句空态，不是一片空白', () => {
    const wrapper = mount(CellsBlock, {
      props: { block: blockOf('cells', '转不动的格', { by_column: [] }) },
    })

    expect(wrapper.findComponent(BarList).props('emptyText')).toBe(
      '这一步一个格子都没有改',
    )
    expect(wrapper.find('.dt-ml-cells__read').text()).toBe(
      '一个格子都没有被改，行数也没变',
    )
  })

  it('样例触到上限时说清只带了前几个', () => {
    const wrapper = mount(CellsBlock, {
      props: {
        block: blockOf('cells', '转不动的格', {
          by_column: [{ key: '湿度', changed: 9, samples: ['--', 'n/a', '?'] }],
        }),
      },
    })

    expect(wrapper.text()).toContain('样例已经列到上限 3 个')
  })

  it('逐列的账触到上限时说清改得少的没带出来', () => {
    const many = Array.from({ length: 12 }, (_, seat) => ({
      key: `列${seat}`,
      changed: 12 - seat,
      samples: [],
    }))
    const wrapper = mount(CellsBlock, {
      props: { block: blockOf('cells', '换了多少个数', { by_column: many }) },
    })

    expect(wrapper.text()).toContain('逐列的账已经列到上限 12 列')
  })

  it('超长的原值截断靠版式，全值挂在 DtTooltip 上', () => {
    const long = '这是一段很长的原值备注文字写在台账里没人管过'
    const wrapper = mount(CellsBlock, {
      props: {
        block: blockOf('cells', '转不动的格', {
          by_column: [{ key: LONG_NAME, changed: 1, samples: [long] }],
        }),
      },
    })
    const head = wrapper.find('.dt-ml-cells__head').findComponent(DtTooltip)
    const sample = wrapper
      .find('.dt-ml-cells__samples')
      .findComponent(DtTooltip)

    expect(head.props('content')).toBe(LONG_NAME)
    expect(sample.props('content')).toBe(long)
    expect(sample.text()).toBe(long)
  })

  it('同一列被讲两遍时两行都在，不会撞 key 少掉一行', () => {
    const wrapper = mount(CellsBlock, {
      props: {
        block: blockOf('cells', '换了多少个数', {
          by_column: [
            { key: '露点', changed: 2, samples: [] },
            { key: '露点', changed: 1, samples: [] },
          ],
        }),
      },
    })

    expect(wrapper.findAll('.dt-ml-cells__rows > li')).toHaveLength(2)
  })
})
