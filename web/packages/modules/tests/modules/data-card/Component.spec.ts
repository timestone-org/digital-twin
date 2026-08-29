/**
 * @fileoverview 契约：可组合卡片摆出来的样子。
 *
 * **守的是「加了部件但画不出来」与「画出来的是假数」这两类**：部件按配置的顺序摆、
 * 所有格共用同一份部件表、取不到值时画占位符而**不伪造 0**、认不出的档不留在画面上。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetCardParts } from '../../../src/cardParts/registry'
import Component from '../../../src/modules/data-card/Component.vue'
import { registerBuiltinCardParts } from '../../../src/modules/data-card/parts'

const CELLS = [
  { label: '进水温度', unit: '℃', precision: 1 },
  { label: '回水温度', unit: '℃', precision: 1 },
]

async function mountCard(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  meta?: Record<string, unknown>,
) {
  const wrapper = mount(Component, {
    props: {
      config: {
        cells: CELLS,
        parts: [{ kind: 'label' }, { kind: 'value' }],
        ...config,
      },
      values,
      ...(meta === undefined ? {} : { meta }),
    },
  })
  // ⚠ 部件是异步组件：只 `flushPromises` 等不到 `import()` 落地，
  //   那时整格是一串空注释，用例会以「什么都没渲染」的样子红
  await vi.dynamicImportSettled()
  await flushPromises()
  return wrapper
}

beforeEach(registerBuiltinCardParts)
afterEach(__resetCardParts)

describe('格与部件', () => {
  it('部件表是卡片级的：两个格画的是同一份部件', async () => {
    const wrapper = await mountCard(
      {},
      { cellValues: [{ value: 12 }, { value: 18 }] },
    )

    expect(wrapper.findAll('.dc-label')).toHaveLength(2)
    expect(wrapper.findAll('.dc-value')).toHaveLength(2)
  })

  it('部件按配置的顺序摆——顺序就是用户在编辑器里拖出来的那个', async () => {
    const wrapper = await mountCard(
      { parts: [{ kind: 'value' }, { kind: 'label' }] },
      { cellValues: [{ value: 12 }] },
    )
    const classes = wrapper
      .findAll('.dc-cell > *')
      .map((node) => node.classes().join(' '))

    expect(classes[0]).toContain('dc-value')
    expect(classes[1]).toContain('dc-label')
  })

  // ⚠ 留着认不出的行会让画面上多一排占位，而用户并没有加过那一件
  it('认不出档名的行直接丢掉，不画占位', async () => {
    const wrapper = await mountCard(
      { cells: [CELLS[0]], parts: [{ kind: 'label' }, { kind: '' }] },
      { cellValues: [{ value: 12 }] },
    )

    expect(wrapper.findAll('.dc-cell > *')).toHaveLength(1)
  })

  // ⚠ 没声明的 prop 会掉成透传属性，在 DOM 上留下 `meta="[object Object]"`，
  //   而 typecheck 与 lint 双双放行
  it('三件套一个都不漏成 DOM 属性', async () => {
    const wrapper = await mountCard({}, { cellValues: [{ value: 12 }] })

    for (const name of ['part', 'cell', 'meta']) {
      expect(wrapper.html()).not.toContain(`${name}="`)
    }
  })

  // ⚠ 两种空的排查方向完全不同
  it('一个格都没有与一个部件都没加，说的是两句话', async () => {
    expect((await mountCard({ cells: [] })).text()).toContain('还没有格')
    expect((await mountCard({ parts: [] })).text()).toContain('还没有加部件')
  })
})

describe('读数', () => {
  it('按格级口径定小数位与单位', async () => {
    const wrapper = await mountCard({}, { cellValues: [{ value: 12.44 }] })

    expect(wrapper.find('.dc-value__num').text()).toBe('12.4')
    expect(wrapper.find('.dc-value__unit').text()).toBe('℃')
  })

  // ⚠ 一个停机的机组显示 0 与显示「—」，运维要做的事完全不同
  it('取不到值时画占位符，绝不伪造 0', async () => {
    const wrapper = await mountCard({}, { cellValues: [{}] })

    expect(wrapper.find('.dc-value__num').text()).toBe('—')
  })

  it('缺值时不画单位——「— ℃」看着像真读到了一个温度', async () => {
    const wrapper = await mountCard({}, { cellValues: [{}] })

    expect(wrapper.find('.dc-value__unit').exists()).toBe(false)
  })

  it('非数值原样透传，开关量的文案走这一路', async () => {
    const wrapper = await mountCard({}, { cellValues: [{ value: '运行' }] })

    expect(wrapper.find('.dc-value__num').text()).toBe('运行')
  })

  it('没起名字的格整件不画名称，也不占位', async () => {
    const wrapper = await mountCard(
      { cells: [{ label: '', unit: '', precision: 0 }] },
      { cellValues: [{ value: 1 }] },
    )

    expect(wrapper.find('.dc-label').exists()).toBe(false)
  })
})

describe('进度条', () => {
  it('接了占比槽就直接用它', async () => {
    const wrapper = await mountCard(
      { parts: [{ kind: 'meter' }] },
      { cellValues: [{ value: 999, ratio: 62 }] },
    )

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain('62%')
  })

  it('没接占比时按量程算', async () => {
    const wrapper = await mountCard(
      { parts: [{ kind: 'meter', 'meter-min': 0, 'meter-max': 200 }] },
      { cellValues: [{ value: 50 }] },
    )

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain('25%')
  })

  // ⚠ 拿 0% 冒充「算不出来」会让一条满量程的管道看着像空的
  it('两条路都算不出时整件不画，不画成 0%', async () => {
    const wrapper = await mountCard(
      { parts: [{ kind: 'meter' }] },
      { cellValues: [{}] },
    )

    expect(wrapper.find('.dc-meter').exists()).toBe(false)
  })

  // ⚠ 条宽夹到 100 而读数不夹：120% 正是要让人看见的那个异常
  it('超量程时条宽夹住而占比读数照实说', async () => {
    const wrapper = await mountCard(
      { parts: [{ kind: 'meter' }] },
      { cellValues: [{ value: 120, ratio: 120 }] },
    )

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain(
      '100%',
    )
    expect(wrapper.find('.dt-meter__pct').text()).toBe('120%')
  })
})

describe('联动', () => {
  it('配了联动值的格点了才上抛', async () => {
    const wrapper = await mountCard(
      { cells: [{ label: '甲', emitValue: 'a' }, { label: '乙' }] },
      { cellValues: [{ value: 1 }, { value: 2 }] },
    )
    const cells = wrapper.findAll('.dc-cell')
    await cells[0]?.trigger('click')
    await cells[1]?.trigger('click')

    expect(wrapper.emitted('interaction')).toHaveLength(1)
    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: 'a' },
    ])
  })
})
