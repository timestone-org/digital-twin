/**
 * @fileoverview 契约：「按项的一组数」这一块画出来的样子——标量档摆指标卡、成组
 * 的数摆横条、基准线画得进才画、算不出来写「—」、顶到上限要说、两档 note 分开摆。
 *
 * ⚠ 夹具照抄后端实测产出（`tree_regressor` / `feature_importance` /
 * `cross_validate` 三个算子的 `report()`），不自己编形状：编的那一份与真实块漂
 * 了之后，这里全绿而界面全错。
 * ⚠ 单位那一条是回归用例：列名当指标键塞进扁平字典时，一列恰好叫 `mape` 会让
 * 无量纲的数被印上百分号（规格 R-34）。这里钉的就是「单位只认 payload」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BarList from '@/pages/Modeling/Canvas/components/BarList.vue'
import BreakdownBlock from '@/pages/Modeling/Canvas/components/BreakdownBlock.vue'
import StatCards from '@/pages/Modeling/Canvas/components/StatCards.vue'
import { buildBreakdown } from '@/pages/Modeling/Canvas/scripts/breakdownParts'
import type { ReportBlock } from '@/pages/Modeling/Canvas/scripts/reportBlocks'

const LONG_NAME = '1#冷冻水泵出口温度与回水温度的差值折算后的读数'

// ⚠ 读数取 DtDigits 那份完整文本：它另有一层逐字锁宽的格子，取整张卡会读到两遍
const READOUT = '.dt-ml-stats__value .dt-digits__text'

/** 后端实测：`tree_regressor` 的「集成结构与两侧拟合分」，逐项各带各的单位。 */
const SHAPE_PAYLOAD = {
  label: '这片树长成什么样，以及它在训练集与测试集上各得几分',
  unit: '',
  score_kind: '',
  baseline: null,
  items: [
    { name: '树的棵数', value: 5, unit: '棵' },
    { name: '最深几层', value: 1, unit: '层' },
    { name: '叶子总数', value: 10, unit: '个' },
    { name: '训练集 R²', value: 0.9733333333333334, score_kind: 'r2' },
    { name: '测试集 R²', value: 0.9733333333333334, score_kind: 'r2' },
  ],
  notes: [
    {
      level: 'hint',
      text: '没有限深度：每棵树一直长到叶子纯为止，训练分必然贴着 1',
    },
  ],
}

/** 后端实测：`feature_importance` 的「特征重要性」，带逐列波动与基线。 */
const IMPORTANCE_PAYLOAD = {
  label: '打乱一列后掉的分；不大于零 = 打乱反而没变差，是噪声列',
  unit: '',
  score_kind: '',
  baseline: 1,
  items: [
    { name: '第0列', value: 2.179754020813623, spread: 0.34848406987992697 },
    { name: '第1列', value: 0, spread: 0 },
  ],
  is_primary: true,
}

/** 后端实测：`cross_validate` 的「逐折分数」，基准是几折的均值。 */
const FOLD_PAYLOAD = {
  label: '每折的分：回归是 R²、分类是准确率',
  unit: '',
  score_kind: 'r2',
  baseline: 0.8,
  items: [
    { name: '第 1 折', value: 0.91 },
    { name: '第 2 折', value: 0.88 },
    { name: '第 3 折', value: 0.61 },
  ],
  is_primary: true,
}

function blockOf(payload: Record<string, unknown>, tier = 1): ReportBlock {
  return {
    kind: 'breakdown',
    zone: tier === 0 ? 'stats' : 'charts',
    port: '',
    title: '这一块',
    tier,
    isPrimary: null,
    payload,
  }
}

function mounted(payload: Record<string, unknown>, tier = 1) {
  return mount(BreakdownBlock, { props: { block: blockOf(payload, tier) } })
}

describe('标量档摆成指标卡', () => {
  it('量纲各不相同的几个数不共用一根轴，走 ② 区那套指标卡', () => {
    const wrapper = mounted(SHAPE_PAYLOAD, 0)

    expect(wrapper.findComponent(BarList).exists()).toBe(false)
    expect(wrapper.findComponent(StatCards).exists()).toBe(true)
    expect(wrapper.findAll('.dt-ml-stats__grid li')).toHaveLength(5)
  })

  it('指标卡按列名档摆：一项恰好叫 r2 也不许被套上那张阈值表的颜色', () => {
    const wrapper = mounted(
      { ...SHAPE_PAYLOAD, items: [{ name: 'r2', value: 0.3 }] },
      0,
    )

    expect(wrapper.findComponent(StatCards).props('space')).toBe('column')
    expect(wrapper.findAll('.dt-ml-stats__unit')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('差')
  })

  it('单位挂在各自那张卡上，不挂的那两张一个字都不多', () => {
    const texts = mounted(SHAPE_PAYLOAD, 0)
      .findAll(READOUT)
      .map((one) => one.text())

    expect(texts).toEqual(['5 棵', '1 层', '10 个', '0.9733', '0.9733'])
  })

  it('这一块一共几个数、缺几个，写在图下一行', () => {
    expect(mounted(SHAPE_PAYLOAD, 0).text()).toContain('共 5 个数，一个都不缺')
  })

  it('算不出来的写成「—」，不写 0', () => {
    const wrapper = mounted(
      {
        ...SHAPE_PAYLOAD,
        items: [
          { name: '训练集 R²', value: null, score_kind: 'r2' },
          { name: '树的棵数', value: 5, unit: '棵' },
        ],
      },
      0,
    )

    expect(wrapper.findAll(READOUT).map((one) => one.text())).toEqual([
      '无定义',
      '5 棵',
    ])
    expect(wrapper.text()).toContain('共 2 个数，其中 1 个算不出来')
  })

  it('值算不出来时连单位都不挂：「无定义 棵」会被读成 0 棵', () => {
    const wrapper = mounted(
      {
        ...SHAPE_PAYLOAD,
        items: [{ name: '树的棵数', value: null, unit: '棵' }],
      },
      0,
    )

    expect(wrapper.find(READOUT).text()).toBe('无定义')
  })

  it('散布跟读数摆在一处，没有散布的那几张一个 ± 都不多', () => {
    const texts = mounted(
      {
        ...SHAPE_PAYLOAD,
        items: [
          { name: '偏均值', value: 0.5, spread: 0.25 },
          { name: '树的棵数', value: 5 },
        ],
      },
      0,
    )
      .findAll(READOUT)
      .map((one) => one.text())

    expect(texts).toEqual(['0.5 ± 0.25', '5'])
  })

  it('卡片的名字用列名原文，不去查那张指标中文名表', () => {
    const wrapper = mounted(
      { ...SHAPE_PAYLOAD, items: [{ name: LONG_NAME, value: 1 }] },
      0,
    )

    expect(wrapper.find('.dt-ml-stats__name').text()).toBe(LONG_NAME)
  })

  it('同名两项各摆各的卡，且各带各的键', () => {
    const payload = {
      ...SHAPE_PAYLOAD,
      items: [
        { name: 'R²', value: 0.9 },
        { name: 'R²', value: 0.4 },
      ],
    }

    expect(
      mounted(payload, 0)
        .findAll(READOUT)
        .map((one) => one.text()),
    ).toEqual(['0.9', '0.4'])
    // ⚠ 键撞了 Vue 只在 patch 时告警、首帧照样两张都画，挂载断言看不见，
    // 只能直接问取料函数
    expect(buildBreakdown(payload, 0).cards.map((card) => card.key)).toEqual([
      '0:R²',
      '1:R²',
    ])
  })

  it('标量档的基准写成一句话，不画线——卡片上没有轴', () => {
    const wrapper = mounted({ ...SHAPE_PAYLOAD, baseline: 0.75 }, 0)

    expect(wrapper.text()).toContain('这批数的基准是 0.75')
  })
})

describe('成组的数摆成横条', () => {
  it('逐列的重要性连波动一起画，读数与名字都是页面上的字', () => {
    const wrapper = mounted(IMPORTANCE_PAYLOAD)

    expect(wrapper.findComponent(BarList).props('items')).toHaveLength(2)
    expect(wrapper.text()).toContain('第0列')
    expect(wrapper.text()).toContain('2.1798 ± 0.3485')
  })

  it('文字结论点名最高与最低那两项，并数出算不出来的', () => {
    expect(mounted(IMPORTANCE_PAYLOAD).text()).toContain(
      '共 2 项：最高「第0列」2.1798，最低「第1列」0',
    )
  })

  it('基准落得进量程时画成参考线，标签带它的值', () => {
    expect(
      mounted(FOLD_PAYLOAD).findComponent(BarList).props('reference'),
    ).toEqual({ value: 0.8, label: '基准 0.8' })
  })

  it('基准落在量程之外时不画到轴上，改成图下一行字', () => {
    const wrapper = mounted({
      ...IMPORTANCE_PAYLOAD,
      baseline: 0.9,
      items: [
        { name: '温度', value: 0.12, spread: 0.01 },
        { name: '湿度', value: 0.01, spread: 0 },
      ],
    })

    expect(wrapper.findComponent(BarList).props('reference')).toBeNull()
    expect(wrapper.text()).toContain(
      '基准是 0.9，落在这批数的量程之外，没有画到轴上',
    )
  })

  it('负值数得出来：打乱反而变好的那几列是结论的一部分', () => {
    const wrapper = mounted({
      ...IMPORTANCE_PAYLOAD,
      baseline: null,
      items: [
        { name: '温度', value: 0.4 },
        { name: '湿度', value: -0.05 },
      ],
    })

    expect(wrapper.text()).toContain('最低「湿度」-0.05')
    expect(wrapper.text()).toContain('1 项是负的，画在零线左侧')
  })

  it('淘汰掉的那几条另有一重非颜色编码', () => {
    const pieces = mounted({
      ...IMPORTANCE_PAYLOAD,
      baseline: null,
      items: [
        { name: '温度', value: 0.4, kept: true },
        { name: '湿度', value: 0.1, kept: false },
      ],
    })
      .findAll('.dt-ml-bars__piece')
      .map((one) => one.classes().join(' '))

    expect(pieces[0]).toContain('dt-ml-bars__piece--primary')
    expect(pieces[1]).toContain('dt-ml-bars__piece--dropped')
  })

  it('单位由 payload 给：一列恰好叫 mape 也不许被印上百分号', () => {
    const wrapper = mounted({
      ...IMPORTANCE_PAYLOAD,
      baseline: null,
      items: [{ name: 'mape', value: 0.12 }],
    })

    expect(wrapper.text()).toContain('0.12')
    expect(wrapper.text()).not.toContain('0.12%')
  })

  it('整块共用一个单位时横条挂得上', () => {
    const wrapper = mounted({
      ...IMPORTANCE_PAYLOAD,
      unit: '行',
      baseline: null,
      items: [{ name: '甲', value: 40 }],
    })

    expect(wrapper.text()).toContain('40 行')
  })

  it('逐项单位各不相同时一个都不挂，不拿第一项的单位套全排', () => {
    const wrapper = mounted({
      ...IMPORTANCE_PAYLOAD,
      baseline: null,
      items: [
        { name: '甲', value: 40, unit: '行' },
        { name: '乙', value: 3, unit: '列' },
      ],
    })

    expect(wrapper.findComponent(BarList).props('unit')).toBe('')
  })
})

describe('四种「没有」各说各的', () => {
  it('一项都没有时给空态，不是一片空白', () => {
    const wrapper = mounted({ ...IMPORTANCE_PAYLOAD, items: [] })

    expect(wrapper.text()).toContain('这一块一项数都没有')
    expect(wrapper.findComponent(BarList).exists()).toBe(false)
  })

  it('全 null 时说「没有一项算得出来」，不报一个最高项', () => {
    expect(
      mounted({
        ...IMPORTANCE_PAYLOAD,
        baseline: null,
        items: [
          { name: '甲', value: null },
          { name: '乙', value: null },
        ],
      }).text(),
    ).toContain('共 2 项，没有一项算得出来')
  })

  it('全零时照常摆条，不当成空态', () => {
    const wrapper = mounted({
      ...IMPORTANCE_PAYLOAD,
      baseline: null,
      items: [
        { name: '甲', value: 0 },
        { name: '乙', value: 0 },
      ],
    })

    expect(wrapper.findComponent(BarList).props('items')).toHaveLength(2)
    expect(wrapper.text()).toContain('最高「甲」0')
  })

  it('只有一项时最高与最低是同一项，照实写', () => {
    expect(
      mounted({
        ...IMPORTANCE_PAYLOAD,
        baseline: null,
        items: [{ name: '甲', value: 3 }],
      }).text(),
    ).toContain('共 1 项：最高「甲」3，最低「甲」3')
  })

  it('顶到 60 项时说清后端可能还截过', () => {
    const many = Array.from({ length: 60 }, (_, seat) => ({
      name: `第${seat}列`,
      value: seat,
    }))

    expect(mounted({ ...IMPORTANCE_PAYLOAD, items: many }).text()).toContain(
      '项数顶到了上限 60 项',
    )
  })

  it('没顶到上限时不摆那句话', () => {
    expect(mounted(IMPORTANCE_PAYLOAD).text()).not.toContain('顶到了上限')
  })

  it('payload 整包读不出来时退化成空态，不抛错', () => {
    expect(mounted({}).text()).toContain('这一块一项数都没有')
  })
})

describe('挂在块上的两档话', () => {
  it('口径说明摆成一行灰字', () => {
    const wrapper = mounted(SHAPE_PAYLOAD, 0)

    expect(wrapper.findAll('.dt-ml-breakdown__note--hint')).toHaveLength(1)
    expect(wrapper.text()).toContain('没有限深度')
  })

  it('告警整条摆出来，且排在口径说明前面', () => {
    const wrapper = mounted(
      {
        ...SHAPE_PAYLOAD,
        notes: [
          { level: 'hint', text: '口径这一句' },
          { level: 'alert', text: '这个模型把训练数据背下来了' },
        ],
      },
      0,
    )
    const notes = wrapper.findAll('[class*=dt-ml-breakdown__note]')

    expect(notes[0]?.classes()).toContain('dt-ml-breakdown__note--alert')
    expect(notes[0]?.text()).toBe('这个模型把训练数据背下来了')
  })

  it('后端把一句话写成纯字符串时也收得住', () => {
    const wrapper = mounted({ ...SHAPE_PAYLOAD, notes: ['旧写法那一句'] }, 0)

    expect(wrapper.findAll('.dt-ml-breakdown__note--hint')).toHaveLength(1)
    expect(wrapper.text()).toContain('旧写法那一句')
  })

  it('读不出正文的那一条丢掉：空气泡比没有更让人疑惑', () => {
    const wrapper = mounted(
      { ...SHAPE_PAYLOAD, notes: [{ level: 'alert', text: '' }, 7] },
      0,
    )

    expect(wrapper.findAll('[class*=dt-ml-breakdown__note]')).toHaveLength(0)
  })
})
