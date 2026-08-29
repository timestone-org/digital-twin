/**
 * @fileoverview 契约：三件带画法分档的部件各档画出来的样子，以及**算不出来时不画**。
 *
 * ⚠ 与 `parts.contract.spec.ts` 分工不同：那边查的是清单登记得对不对（加部件时漏了
 * 会静默失效），这边查的是画出来对不对。分开是因为前者是结构断言、后者要挂载。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetCardParts } from '../../../src/cardParts/registry'
import Component from '../../../src/modules/data-card/Component.vue'
import { registerBuiltinCardParts } from '../../../src/modules/data-card/parts'

/**
 * 摆一张只有一格的卡片，部件表由用例给。
 * @param parts 部件表
 * @param slot 这一格四个子槽的取值
 */
async function mountOne(
  parts: readonly Record<string, unknown>[],
  slot: Record<string, unknown> = { value: 50 },
) {
  const wrapper = mount(Component, {
    props: {
      config: { cells: [{ label: '甲', unit: '℃', precision: 1 }], parts },
      values: { cellValues: [slot] },
    },
  })
  // ⚠ 部件是异步组件：只 `flushPromises` 等不到 `import()` 落地
  await vi.dynamicImportSettled()
  await flushPromises()
  return wrapper
}

beforeEach(registerBuiltinCardParts)
afterEach(__resetCardParts)

describe('分隔线', () => {
  it('缺省画一道实线', async () => {
    const wrapper = await mountOne([{ kind: 'divider' }])

    expect(wrapper.find('hr.dc-rule--line').exists()).toBe(true)
  })

  it('虚线档换的是线型，不是另一个元素', async () => {
    const wrapper = await mountOne([
      { kind: 'divider', 'divider-look': 'dashed' },
    ])

    expect(wrapper.find('hr.dc-rule--dashed').exists()).toBe(true)
  })

  // ⚠ 「只留空」仍然渲染一个元素：排布出问题时它是唯一还看得见的参照物，
  //   `v-if` 掉的话「我加了间隔但没反应」查不出来自哪一件
  it('只留空那一档不画线，但仍占一个元素', async () => {
    const wrapper = await mountOne([
      { kind: 'divider', 'divider-look': 'blank' },
    ])

    expect(wrapper.find('hr').exists()).toBe(false)
    expect(wrapper.find('span.dc-rule--blank').exists()).toBe(true)
  })

  it('上下间隔按配置走', async () => {
    const wrapper = await mountOne([{ kind: 'divider', 'divider-gap': 14 }])
    const style = wrapper.find('.dc-rule').attributes('style') ?? ''

    expect(style).toContain('margin-top: 14px')
    expect(style).toContain('margin-bottom: 14px')
  })

  // ⚠ 「没配 = 不写值」：写了就再也回落不到卡片边框色
  it('没配颜色时不写 border-color，留给卡片边框色兜底', async () => {
    const bare = await mountOne([{ kind: 'divider' }])
    const painted = await mountOne([
      { kind: 'divider', 'divider-color': '#ff0000' },
    ])

    expect(bare.find('.dc-rule').attributes('style')).not.toContain(
      'border-color',
    )
    expect(painted.find('.dc-rule').attributes('style')).toContain(
      'border-color: #ff0000',
    )
  })
})

describe('进度条', () => {
  it('接了「占比」槽就直接用它，不再按量程算', async () => {
    const wrapper = await mountOne([{ kind: 'meter' }], {
      value: 10,
      ratio: 80,
    })

    expect(wrapper.find('.dt-meter__fill').attributes('style')).toContain('80%')
  })

  it('读数可以关掉：只留一条不带百分比的条', async () => {
    const wrapper = await mountOne([
      { kind: 'meter', 'meter-showPercent': false },
    ])

    expect(wrapper.find('.dt-meter__fill').exists()).toBe(true)
    expect(wrapper.find('.dt-meter__pct').exists()).toBe(false)
  })

  it('说明文字配了就画在条上', async () => {
    const wrapper = await mountOne([
      { kind: 'meter', 'meter-caption': '负荷率' },
    ])

    expect(wrapper.text()).toContain('负荷率')
  })

  describe('粗轨道档', () => {
    it('画的是带刻度的那一档', async () => {
      const wrapper = await mountOne([{ kind: 'meter', 'meter-look': 'track' }])

      expect(wrapper.find('.dt-meter--track').exists()).toBe(true)
    })

    // ⚠ 目标线读的是「辅助」槽：没开开关时那一槽的值不该悄悄画成一条线
    it('开了目标线才把辅助槽画成目标', async () => {
      const off = await mountOne([{ kind: 'meter', 'meter-look': 'track' }], {
        value: 50,
        aux: 80,
      })
      const on = await mountOne(
        [
          {
            kind: 'meter',
            'meter-look': 'track',
            'meter-showTarget': true,
            'meter-targetLabel': '目标 ',
          },
        ],
        { value: 50, aux: 80 },
      )

      expect(off.find('.dt-meter__target').exists()).toBe(false)
      expect(on.find('.dt-meter__target').exists()).toBe(true)
      expect(on.text()).toContain('目标 ')
    })

    it('细条档不画刻度', async () => {
      const wrapper = await mountOne([{ kind: 'meter', 'meter-look': 'bar' }])

      expect(wrapper.find('.dt-meter--track').exists()).toBe(false)
    })
  })
})

describe('读数的四档', () => {
  /**
   * 带逐槽结论摆一张卡片。
   * @param slot 这一槽的结论；`undefined` = 没接过来源，故不进表
   */
  async function withSlot(slot?: ModuleSlotMeta) {
    const wrapper = mount(Component, {
      props: {
        config: {
          cells: [{ label: '甲', unit: '℃' }],
          parts: [{ kind: 'value' }],
        },
        values: { cellValues: [{}] },
        meta: {
          slots: slot === undefined ? {} : { 'cellValues[0].value': slot },
        },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()
    return wrapper.find('.dc-value__num')
  }

  // ⚠ 模块自报 ownsStatusDisplay，整格浮层已经让开了：这三档在这里合成一档，
  //   现场断了的那一格与从没配过的那一格在墙上就一模一样
  it('没配来源 / 等首帧 / 取不到，三档各画各的', async () => {
    const unbound = await withSlot()
    const pending = await withSlot({ state: 'pending' })
    const error = await withSlot({ state: 'error' })

    expect(unbound.classes()).toContain('dc-value__num--unbound')
    expect(pending.classes()).toContain('dc-value__num--pending')
    expect(error.classes()).toContain('dc-value__num--error')
  })

  it('原因整句挂 title——一格的宽度摆不下短标签', async () => {
    const pending = await withSlot({ state: 'pending' })
    const error = await withSlot({ state: 'error', message: '通道断了' })

    expect(pending.attributes('title')).toContain('还没收到第一帧')
    expect(error.attributes('title')).toContain('通道断了')
  })

  // ⚠ 三档一律画占位符：取数侧说取不到，却把上一帧的值留在墙上就是在骗人
  it('取不到时画占位符，也不留单位', async () => {
    const wrapper = mount(Component, {
      props: {
        config: {
          cells: [{ label: '甲', unit: '℃' }],
          parts: [{ kind: 'value' }],
        },
        values: { cellValues: [{ value: 42 }] },
        meta: { slots: { 'cellValues[0].value': { state: 'error' } } },
      },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(wrapper.find('.dc-value__num').text()).not.toContain('42')
    expect(wrapper.find('.dc-value__unit').exists()).toBe(false)
  })

  // ⚠ 运行时不下发结论的两处（设计态画布、独立挂载）注的是演示值：
  //   把它们一律判成没配来源的话，编辑器里整张卡片是一片「—」
  it('运行时没下发结论时按有没有值判，演示值照画', async () => {
    const wrapper = await mountOne([{ kind: 'value' }], { value: 42 })

    expect(wrapper.find('.dc-value__num').text()).toContain('42')
    expect(wrapper.find('.dc-value__num').classes()).toContain(
      'dc-value__num--ok',
    )
  })
})

describe('排布', () => {
  it('缺省整行流，一件一行', async () => {
    const wrapper = await mountOne([{ kind: 'label' }, { kind: 'value' }])

    expect(wrapper.find('.dc-line').exists()).toBe(false)
  })

  it('左右两件配成一行，各归各簇', async () => {
    const wrapper = await mountOne([
      { kind: 'label', place: 'left' },
      { kind: 'value', place: 'right' },
    ])
    const line = wrapper.find('.dc-line')

    expect(line.exists()).toBe(true)
    expect(
      line
        .find('.dc-line__side:not(.dc-line__side--end)')
        .find('.dc-label')
        .exists(),
    ).toBe(true)
    expect(line.find('.dc-line__side--end').find('.dc-value').exists()).toBe(
      true,
    )
  })

  // ⚠ 不断开的话两组会挤成一行四件，而用户摆的是两行
  it('右件之后再来左件就换行', async () => {
    const wrapper = await mountOne([
      { kind: 'label', place: 'left' },
      { kind: 'value', place: 'right' },
      { kind: 'label', place: 'left' },
      { kind: 'value', place: 'right' },
    ])

    expect(wrapper.findAll('.dc-line')).toHaveLength(2)
  })

  it('整行件把前后两组配对切开', async () => {
    const wrapper = await mountOne([
      { kind: 'label', place: 'left' },
      { kind: 'value', place: 'right' },
      { kind: 'divider' },
      { kind: 'label', place: 'left' },
      { kind: 'value', place: 'right' },
    ])

    expect(wrapper.findAll('.dc-line')).toHaveLength(2)
    expect(wrapper.find('.dc-rule').exists()).toBe(true)
  })

  // ⚠ 认不出的占位档要当整行画，不能把那一件扔掉
  it('占位档写错时那一件仍在，按整行画', async () => {
    const wrapper = await mountOne([{ kind: 'value', place: 'middle' }])

    expect(wrapper.find('.dc-value').exists()).toBe(true)
    expect(wrapper.find('.dc-line').exists()).toBe(false)
  })
})
