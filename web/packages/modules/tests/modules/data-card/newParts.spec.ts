/**
 * @fileoverview 契约：为覆盖列表族补的四个部件（徽标 / 短标签 / 附加字段 / 图标），
 * 以及进度条的选槽与三档口径（MODULE_DATA_CARD_DESIGN §11.4–§11.5）。
 *
 * ⚠ 这些件多半是「没接数据时该画什么」出问题：藏了整件会让一排卡片里那一格
 * 少一行、看着像布局坏了；画成 0 又是在伪造读数。每一件的缺值分支都在这里钉住。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetCardParts } from '../../../src/cardParts/registry'
import Component from '../../../src/modules/data-card/Component.vue'
import { registerBuiltinCardParts } from '../../../src/modules/data-card/parts'

/**
 * 摆一张卡片。
 * @param parts 部件表
 * @param rows 逐格的子槽取值
 * @param cells 格表；缺省是一格
 */
async function card(
  parts: readonly Record<string, unknown>[],
  rows: readonly Record<string, unknown>[] = [{}],
  cells?: readonly Record<string, unknown>[],
) {
  const wrapper = mount(Component, {
    props: {
      config: {
        cells: cells ?? [{ label: '甲', unit: '℃', precision: 1 }],
        parts,
      },
      values: { cellValues: [...rows] },
    },
  })
  // ⚠ 部件是异步组件：只 `flushPromises` 等不到 `import()` 落地
  await vi.dynamicImportSettled()
  await flushPromises()
  return wrapper
}

beforeEach(registerBuiltinCardParts)
afterEach(__resetCardParts)

describe('状态徽标', () => {
  it('按 state 槽分档', async () => {
    const wrapper = await card([{ kind: 'badge' }], [{ state: 1 }])

    expect(wrapper.find('.dt-status-badge--running').exists()).toBe(true)
  })

  // ⚠ 状态位空着本身就要看得见：整件藏掉的话那台设备连位置都不占
  it('没接 state 槽时画「未知」，不隐藏', async () => {
    const wrapper = await card([{ kind: 'badge' }])

    expect(wrapper.find('.dt-status-badge--unknown').exists()).toBe(true)
  })

  it('覆盖文案固定显示，圆点仍随状态变色', async () => {
    const wrapper = await card(
      [{ kind: 'badge', 'badge-text': '运行中' }],
      [{ state: 3 }],
    )

    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.find('.dt-status-badge--alarm').exists()).toBe(true)
  })

  it('只留圆点那一档不画文案', async () => {
    const wrapper = await card(
      [{ kind: 'badge', 'badge-style': 'dot' }],
      [{ state: 1 }],
    )

    expect(wrapper.find('.dc-badge--dot').exists()).toBe(true)
    expect(wrapper.text()).toBe('')
  })
})

describe('短标签', () => {
  it('画配的那段字', async () => {
    const wrapper = await card([{ kind: 'tag', 'tag-text': '1#' }])

    expect(wrapper.find('.dc-tag').text()).toBe('1#')
  })

  // ⚠ 胶囊档留个空壳在那里，看着像渲染坏了
  it('文字留空时整件不画', async () => {
    const wrapper = await card([{ kind: 'tag' }])

    expect(wrapper.find('.dc-tag').exists()).toBe(false)
  })

  it('三档样式换的是类名', async () => {
    const wrapper = await card([
      { kind: 'tag', 'tag-text': 'A', 'tag-look': 'outline' },
    ])

    expect(wrapper.find('.dc-tag--outline').exists()).toBe(true)
  })
})

describe('附加字段', () => {
  it('各自选槽，摆三个就是三个字段', async () => {
    const wrapper = await card(
      [
        { kind: 'extra', 'extra-slot': 'extra1', 'extra-label': '功率' },
        { kind: 'extra', 'extra-slot': 'extra2', 'extra-label': '温度' },
        { kind: 'extra', 'extra-slot': 'extra3', 'extra-label': '流量' },
      ],
      [{ extra1: 12, extra2: 34, extra3: 56 }],
    )
    const nums = wrapper.findAll('.dc-extra__num').map((one) => one.text())

    expect(nums).toEqual(['12', '34', '56'])
  })

  // ⚠ 附加字段装的是另一种量，硬套主读数的单位就是在墙上写错单位
  it('单位逐件配，不吃格级单位', async () => {
    const wrapper = await card(
      [{ kind: 'extra', 'extra-slot': 'extra1', 'extra-unit': 'kW' }],
      [{ extra1: 12 }],
    )

    expect(wrapper.find('.dc-extra__unit').text()).toBe('kW')
  })

  it('小数位逐件配', async () => {
    const wrapper = await card(
      [{ kind: 'extra', 'extra-slot': 'extra1', 'extra-precision': 3 }],
      [{ extra1: 1.23456 }],
    )

    expect(wrapper.find('.dc-extra__num').text()).toBe('1.235')
  })

  // ⚠ 藏了的话一排卡片里这一格会少一行，看着像布局坏了
  it('取不到值时画占位符，整件仍在，且不画单位', async () => {
    const wrapper = await card([
      { kind: 'extra', 'extra-slot': 'extra1', 'extra-unit': 'kW' },
    ])

    expect(wrapper.find('.dc-extra__num').text()).toBe('—')
    expect(wrapper.find('.dc-extra__unit').exists()).toBe(false)
  })

  it('标签留空时只画读数', async () => {
    const wrapper = await card(
      [{ kind: 'extra', 'extra-slot': 'extra1' }],
      [{ extra1: 7 }],
    )

    expect(wrapper.find('.dc-extra__label').exists()).toBe(false)
  })
})

describe('图标', () => {
  // ⚠ 部件是卡片级的：图标若只配在部件上，一整张卡片十个格会画同一个
  it('格上配的优先，逐格各画各的', async () => {
    const wrapper = await card(
      [{ kind: 'icon' }],
      [{}, {}],
      [
        { label: '甲', icon: 'https://x/a.png' },
        { label: '乙', icon: 'https://x/b.png' },
      ],
    )
    const src = wrapper
      .findAll('.dc-icon__img')
      .map((one) => one.attributes('src'))

    expect(src).toEqual(['https://x/a.png', 'https://x/b.png'])
  })

  it('格上没配时用部件上的回落——整卡同一个图标只配一处', async () => {
    const wrapper = await card([
      { kind: 'icon', 'icon-fallback': 'https://x/f.png' },
    ])

    expect(wrapper.find('.dc-icon__img').attributes('src')).toBe(
      'https://x/f.png',
    )
  })

  // ⚠ 画个空框会让没配图标的那几格看着像加载失败
  it('两处都没有时整件不画', async () => {
    const wrapper = await card([{ kind: 'icon' }])

    expect(wrapper.find('.dc-icon').exists()).toBe(false)
  })
})

describe('进度条的口径', () => {
  // ⚠ 「自动」是缺省，保的是「多数场合可以不接 ratio 槽」那条口径
  it('自动档：接了占比槽直读它', async () => {
    const wrapper = await card([{ kind: 'meter' }], [{ value: 10, ratio: 80 }])

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain('80%')
  })

  it('自动档：没接占比槽时按量程折算主读数', async () => {
    const wrapper = await card(
      [{ kind: 'meter', 'meter-min': 0, 'meter-max': 200 }],
      [{ value: 50 }],
    )

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain('25%')
  })

  it('占全卡之比：按全部格的合计算', async () => {
    const wrapper = await card(
      [{ kind: 'meter', 'meter-source': 'share', 'meter-slot': 'value' }],
      [{ value: 25 }, { value: 75 }],
      [{ label: '甲' }, { label: '乙' }],
    )
    const fills = wrapper
      .findAll('.dt-meter__fill')
      .map((one) => one.attributes('style'))

    expect(fills[0]).toContain('25%')
    expect(fills[1]).toContain('75%')
  })

  // ⚠ 合计为 0 不是 0%，是算不出来：除零画出来是 Infinity%
  it('占全卡之比：合计为 0 时整件不画', async () => {
    const wrapper = await card(
      [{ kind: 'meter', 'meter-source': 'share', 'meter-slot': 'value' }],
      [{ value: 0 }, { value: 0 }],
      [{ label: '甲' }, { label: '乙' }],
    )

    expect(wrapper.find('.dt-meter__fill').exists()).toBe(false)
  })

  it('占全卡之比：一个数都取不到的槽算不出来，不画', async () => {
    const wrapper = await card([
      { kind: 'meter', 'meter-source': 'share', 'meter-slot': 'extra1' },
    ])

    expect(wrapper.find('.dt-meter__fill').exists()).toBe(false)
  })

  // ⚠ 一格两条（占比 + 液位）靠各自选槽互不打架
  it('一格摆两条，各读各的槽', async () => {
    const wrapper = await card(
      [
        { kind: 'meter', 'meter-source': 'ratio', 'meter-slot': 'ratio' },
        { kind: 'meter', 'meter-source': 'ratio', 'meter-slot': 'aux2' },
      ],
      [{ ratio: 30, aux2: 70 }],
    )
    const fills = wrapper
      .findAll('.dt-meter__fill')
      .map((one) => one.attributes('style'))

    expect(fills[0]).toContain('30%')
    expect(fills[1]).toContain('70%')
  })

  it('显式量程档读指定的槽', async () => {
    const wrapper = await card(
      [
        {
          kind: 'meter',
          'meter-source': 'range',
          'meter-slot': 'aux',
          'meter-min': 0,
          'meter-max': 50,
        },
      ],
      [{ value: 999, aux: 10 }],
    )

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain('20%')
  })
})

describe('分组', () => {
  const CELLS = [
    { label: '甲', group: '洗浴' },
    { label: '乙', group: '空调' },
    { label: '丙', group: '洗浴' },
  ]

  it('不分组时所有格摆在一起，没有页签也没有段头', async () => {
    const wrapper = await card([{ kind: 'label' }], [{}, {}, {}], CELLS)

    expect(wrapper.find('.dc-tabs').exists()).toBe(false)
    expect(wrapper.find('.dc-sec__head').exists()).toBe(false)
    expect(wrapper.findAll('.dc-cell')).toHaveLength(3)
  })

  it('分段档每组一个段头，组序是摆出来的顺序', async () => {
    const wrapper = mount(Component, {
      props: {
        config: {
          cells: CELLS,
          parts: [{ kind: 'label' }],
          grouping: 'section',
        },
        values: { cellValues: [{}, {}, {}] },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(wrapper.findAll('.dc-sec__head').map((one) => one.text())).toEqual([
      '洗浴',
      '空调',
    ])
  })

  it('页签档只摆选中那一组', async () => {
    const wrapper = mount(Component, {
      props: {
        config: { cells: CELLS, parts: [{ kind: 'label' }], grouping: 'tabs' },
        values: { cellValues: [{}, {}, {}] },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(wrapper.findAll('.dc-tabs__one')).toHaveLength(2)
    expect(wrapper.findAll('.dc-cell')).toHaveLength(2)
  })

  it('点页签换组', async () => {
    const wrapper = mount(Component, {
      props: {
        config: { cells: CELLS, parts: [{ kind: 'label' }], grouping: 'tabs' },
        values: { cellValues: [{}, {}, {}] },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()
    await wrapper.findAll('.dc-tabs__one')[1]?.trigger('click')

    expect(wrapper.findAll('.dc-cell')).toHaveLength(1)
  })

  // ⚠ 切到某一页再看计数会变，是第一眼就当成 bug 的那种不一致
  it('页签计数用全量格数，不随选中的页签变', async () => {
    const wrapper = mount(Component, {
      props: {
        config: { cells: CELLS, parts: [{ kind: 'label' }], grouping: 'tabs' },
        values: { cellValues: [{}, {}, {}] },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()
    const before = wrapper.findAll('.dc-tabs__n').map((one) => one.text())
    await wrapper.findAll('.dc-tabs__one')[1]?.trigger('click')

    expect(before).toEqual(['2', '1'])
    expect(wrapper.findAll('.dc-tabs__n').map((one) => one.text())).toEqual(
      before,
    )
  })

  it('初始页签认得出来', async () => {
    const wrapper = mount(Component, {
      props: {
        config: {
          cells: CELLS,
          parts: [{ kind: 'label' }],
          grouping: 'tabs',
          defaultGroup: '空调',
        },
        values: { cellValues: [{}, {}, {}] },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(wrapper.find('.dc-tabs__one--on').text()).toContain('空调')
  })
})

describe('告警规则', () => {
  const RULES = [
    { op: 'gt', value: 55, level: 'danger', label: '高温', blink: true },
    { op: 'gt', value: 40, level: 'warning', color: 'var(--state-warning)' },
  ]

  async function withRules(
    rows: readonly Record<string, unknown>[],
    over = {},
  ) {
    const wrapper = mount(Component, {
      props: {
        config: {
          cells: rows.map((_row, at) => ({ label: `第${String(at)}` })),
          parts: [{ kind: 'value' }],
          rules: RULES,
          ...over,
        },
        values: { cellValues: [...rows] },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()
    return wrapper
  }

  it('命中的格描边并呼吸，没命中的不动', async () => {
    const wrapper = await withRules([{ value: 60 }, { value: 10 }])
    const cells = wrapper.findAll('.dc-cell')

    expect(cells[0]?.classes()).toContain('dc-cell--alarm')
    expect(cells[1]?.classes()).not.toContain('dc-cell--alarm')
  })

  it('闪烁跟着命中的那条规则走', async () => {
    const wrapper = await withRules([{ value: 60 }, { value: 45 }])
    const cells = wrapper.findAll('.dc-cell')

    expect(cells[0]?.classes()).toContain('dc-cell--blink')
    expect(cells[1]?.classes()).not.toContain('dc-cell--blink')
  })

  // ⚠ 直接写 border-color 会让「左色条」外壳档当场丢掉自己那套描边
  it('规则的颜色走变量，不直接写描边色', async () => {
    const wrapper = await withRules([{ value: 45 }])

    expect(wrapper.find('.dc-cell').attributes('style')).toContain('--dc-alarm')
  })

  it('规则判哪个槽可以改', async () => {
    const wrapper = await withRules([{ value: 10, aux: 60 }], {
      alarmOn: 'aux',
    })

    expect(wrapper.find('.dc-cell').classes()).toContain('dc-cell--alarm')
  })

  it('没有规则时一格都不告警', async () => {
    const wrapper = await withRules([{ value: 999 }], { rules: [] })

    expect(wrapper.find('.dc-cell').classes()).not.toContain('dc-cell--alarm')
  })
})
