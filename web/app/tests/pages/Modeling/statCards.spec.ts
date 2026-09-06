/**
 * @fileoverview ② 区外壳：只有有公认好坏线的指标才三档染色，算不出来的写
 * 「无定义」并把那条口径说明摊在卡片上，超过 8 张要标注截断。
 *
 * ⚠ 键与取值照抄后端真正产出的那几组（`evaluate.py::_metrics_of`、
 * `diagnostics.py::_residual_stats`）：手编一份键名漂了的，染色与单位会整片
 * 退化成灰，而用例照绿。
 */
import { DtCard, DtDigits, DtHelpTip, DtTag } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StatCards from '@/pages/Modeling/Canvas/components/StatCards.vue'
import type { StatItem } from '@/pages/Modeling/Canvas/scripts/statCards'
import { MAX_STAT_CARDS } from '@/pages/Modeling/Canvas/scripts/statCards'

function cardsOf(items: readonly StatItem[], space?: 'metric' | 'column') {
  return mount(StatCards, {
    props: space === undefined ? { items } : { items, space },
  })
}

function tagIntents(wrapper: ReturnType<typeof cardsOf>): string[] {
  return wrapper
    .findAllComponents(DtTag)
    .map((one) => String(one.props('intent')))
}

// 回归评估真正产出的那四个键
const REGRESSION: StatItem[] = [
  { key: 'r2', value: 0.9312 },
  { key: 'rmse', value: 3.4157 },
  { key: 'mae', value: 2.6 },
  { key: 'mape', value: 8.4 },
]

describe('三档染色', () => {
  it('有公认好坏线的指标才染色，且颜色不是唯一编码', () => {
    const wrapper = cardsOf([
      { key: 'r2', value: 0.95 },
      { key: 'accuracy', value: 0.8 },
      { key: 'f1', value: 0.4 },
    ])

    expect(tagIntents(wrapper)).toEqual(['success', 'warning', 'danger'])
    expect(wrapper.findAllComponents(DtTag).map((one) => one.text())).toEqual([
      '好',
      '一般',
      '差',
    ])
  })

  it('MAPE 越小越好，与 R² 用的不是同一个方向', () => {
    expect(tagIntents(cardsOf([{ key: 'mape', value: 8.4 }]))).toEqual([
      'success',
    ])
  })

  it('跟着量纲走的那几个一律不染色，也不摆档位词', () => {
    const wrapper = cardsOf([
      { key: 'mae', value: 2.6 },
      { key: 'rmse', value: 3.4 },
      { key: 'max_error', value: 12 },
      { key: 'residual_std', value: 1.2 },
    ])

    expect(wrapper.findAllComponents(DtTag)).toHaveLength(0)
    expect(wrapper.findAllComponents(DtCard)).toHaveLength(4)
  })

  it('置换重要性那一档一律不查阈值表：某一列恰好叫 r2 也不许被染色', () => {
    const wrapper = cardsOf([{ key: 'r2', value: 0.95 }], 'column')

    expect(wrapper.findAllComponents(DtTag)).toHaveLength(0)
    expect(wrapper.find('.dt-ml-stats__name').text()).toContain('r2')
  })
})

describe('读数', () => {
  it('中文名与单位都取自口径表，数走 niceNumber', () => {
    const wrapper = cardsOf(REGRESSION)
    const names = wrapper.findAll('.dt-ml-stats__name').map((one) => one.text())
    const reads = wrapper
      .findAllComponents(DtDigits)
      .map((one) => one.props('value'))

    expect(names.map((one) => one.split(' ')[0])).toEqual([
      'R²',
      'RMSE',
      'MAE',
      'MAPE',
    ])
    expect(reads).toEqual(['0.9312', '3.4157', '2.6', '8.4'])
    expect(
      wrapper.findAll('.dt-ml-stats__unit').map((one) => one.text()),
    ).toEqual(['%'])
  })

  it('调用方给了排好版的读数就照它印，不再走 niceNumber', () => {
    const wrapper = cardsOf([
      { key: 'rows', value: 12480, label: '保留行数', text: '12,480 行' },
    ])

    expect(wrapper.findComponent(DtDigits).props('value')).toBe('12,480 行')
    expect(wrapper.find('.dt-ml-stats__name').text()).toBe('保留行数')
  })
})

describe('无定义', () => {
  const NONE: StatItem[] = [
    {
      key: 'mape',
      value: null,
      hint: '真值里有 0，除以它算不出百分比，这几行整条剔掉后就一行都不剩了',
    },
  ]

  it('值算不出来时写「无定义」，不写 0', () => {
    const wrapper = cardsOf(NONE)

    expect(wrapper.findComponent(DtDigits).props('value')).toBe('无定义')
    expect(wrapper.find('.dt-ml-stats__value--none').exists()).toBe(true)
  })

  it('无定义时那条口径说明自动摊在卡片上，不藏进小问号', () => {
    const wrapper = cardsOf(NONE)

    expect(wrapper.find('.dt-ml-stats__why').text()).toBe(
      '≤ 10% 算好，≤ 20% 算一般；真值里有 0，除以它算不出百分比，' +
        '这几行整条剔掉后就一行都不剩了',
    )
    expect(wrapper.findComponent(DtHelpTip).exists()).toBe(false)
  })

  it('无定义不染色：染成红色会被读成「算出来了，而且很差」', () => {
    expect(cardsOf(NONE).findAllComponents(DtTag)).toHaveLength(0)
  })

  it('无定义不带单位：「无定义 %」读不出来是什么', () => {
    expect(cardsOf(NONE).find('.dt-ml-stats__unit').exists()).toBe(false)
  })

  it('有数时口径说明收进小问号', () => {
    const wrapper = cardsOf([{ key: 'mae', value: 2.6 }])

    expect(wrapper.findComponent(DtHelpTip).props('text')).toBe(
      '好坏取决于这一列的量纲，这里不替你下结论',
    )
    expect(wrapper.find('.dt-ml-stats__why').exists()).toBe(false)
  })
})

describe('退化', () => {
  it('一项都没有时整块不摆，不摆一排空卡', () => {
    expect(cardsOf([]).find('.dt-ml-stats').exists()).toBe(false)
  })

  it('只有一项时照样摆，网格自己撑开', () => {
    expect(
      cardsOf([{ key: 'r2', value: 0.9 }]).findAllComponents(DtCard),
    ).toHaveLength(1)
  })

  it('全是 null 时每一张都写无定义，一个 0 都不补', () => {
    const wrapper = cardsOf([
      { key: 'r2', value: null },
      { key: 'mae', value: null },
    ])

    expect(
      wrapper.findAllComponents(DtDigits).map((one) => one.props('value')),
    ).toEqual(['无定义', '无定义'])
  })

  it('全是 0 时照实印 0，不当成无定义', () => {
    const wrapper = cardsOf([{ key: 'residual_mean', value: 0 }])

    expect(wrapper.findComponent(DtDigits).props('value')).toBe('0')
    expect(wrapper.find('.dt-ml-stats__value--none').exists()).toBe(false)
  })

  it('超过 8 张时只摆前 8 张并说清一共几项', () => {
    const many: StatItem[] = Array.from({ length: 11 }, (_, at) => ({
      key: `列${at}`,
      value: at,
    }))
    const wrapper = cardsOf(many, 'column')

    expect(wrapper.findAllComponents(DtCard)).toHaveLength(MAX_STAT_CARDS)
    expect(wrapper.find('.dt-ml-stats__more').text()).toBe(
      '只列了前 8 项，共 11 项',
    )
  })

  it('没截断时不摆那一行', () => {
    expect(cardsOf(REGRESSION).find('.dt-ml-stats__more').exists()).toBe(false)
  })

  it('认不出来的指标名原样印，且不给它一个没根据的颜色', () => {
    const wrapper = cardsOf([{ key: 'weird_score', value: 1.5 }])

    expect(wrapper.find('.dt-ml-stats__name').text()).toContain('weird_score')
    expect(wrapper.findAllComponents(DtTag)).toHaveLength(0)
  })

  it('极长的指标名照印全名，卡片自己换行不撑破网格', () => {
    const long = '这是一个特别长的中文指标名长到必须换行才摆得下的那一种'
    const wrapper = cardsOf([{ key: 'r2', value: 0.9, label: long }])

    expect(wrapper.find('.dt-ml-stats__name').text()).toContain(long)
  })
})
