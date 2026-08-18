/**
 * @fileoverview 守实时数值模块的渲染：三种排布摆出来的列数、没读数的格子不留白、
 * 单格大字只在「自动 + 一项」时成立，以及联动上抛的吞冒泡口径。
 * ⚠ 最后一条错了 typecheck 与 lint 都放行：表现是点一下 toggle 自我抵消。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/metric-card/Component.vue'
import manifest from '../../../src/modules/metric-card/manifest'
import { metricFieldKey } from '../../../src/modules/metric-card/metrics'
import { configDefaults } from '../../../src/shared/config'

const OK: ModuleSlotMeta = { state: 'ok', timestampMs: 1_700_000_000_000 }

function render(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  slots?: Record<string, ModuleSlotMeta>,
) {
  return mount(Component, {
    props: {
      config: { ...configDefaults(manifest.configSchema), ...config },
      values,
      ...(slots === undefined ? {} : { meta: { slots } }),
    },
  })
}

/** 注入袋：第 index 行的读数。 */
function rows(...values: unknown[]): Record<string, unknown> {
  return { itemValues: values.map((value) => ({ value })) }
}

function texts(wrapper: ReturnType<typeof render>, selector: string): string[] {
  return wrapper.findAll(selector).map((node) => node.text())
}

const THREE = [
  { label: '温度', unit: '°C', precision: 1 },
  { label: '电压', unit: 'kV', precision: 2 },
  { label: '功率', unit: 'MW', precision: 2 },
]

describe('实时数值的排布', () => {
  it('自动档只有一项时是单格大字', () => {
    const wrapper = render({ items: [{ label: '主变温度' }] })

    expect(wrapper.get('.metric-card').classes()).toContain(
      'metric-card--single',
    )
    expect(wrapper.get('.metric-card').attributes('style')).toContain(
      'repeat(1,',
    )
  })

  it('自动档多项时按项数铺列，不会窄到只剩省略号', () => {
    expect(
      render({ items: THREE }).get('.metric-card').attributes('style'),
    ).toContain('repeat(2,')
    expect(
      render({ items: [...THREE, ...THREE, ...THREE, ...THREE] })
        .get('.metric-card')
        .attributes('style'),
    ).toContain('repeat(4,')
  })

  it('网格档听配置的列数，脏值夹回合法区间——0 会让整条声明作废', () => {
    expect(
      render({ items: THREE, layout: 'grid', columns: 3 })
        .get('.metric-card')
        .attributes('style'),
    ).toContain('repeat(3,')
    expect(
      render({ items: THREE, layout: 'grid', columns: 0 })
        .get('.metric-card')
        .attributes('style'),
    ).toContain('repeat(1,')
  })

  it('列表档每项一行，名称在左读数在右', () => {
    const wrapper = render({ items: THREE, layout: 'list' })

    expect(wrapper.get('.metric-card').attributes('style')).toContain(
      'repeat(1,',
    )
    expect(wrapper.findAll('.metric-cell--row')).toHaveLength(3)
  })

  it('每一项都画出来了：配了却不渲染的项等于「配了没反应」', () => {
    const wrapper = render({ items: THREE, layout: 'auto' })

    expect(texts(wrapper, '.metric-cell__label')).toEqual([
      '温度',
      '电压',
      '功率',
    ])
  })
})

describe('实时数值的逐格交代', () => {
  it('没有读数的格子画短标签而不是留白', () => {
    const wrapper = render({ items: THREE }, rows(), {
      [metricFieldKey(1)]: { state: 'pending' },
      [metricFieldKey(2)]: { state: 'error', message: '快照读不到' },
    })

    expect(texts(wrapper, '.metric-cell__state')).toEqual([
      '未绑定',
      '等待首帧',
      '取不到',
    ])
  })

  it('完整原因挂在格子上，鼠标停上去看得全', () => {
    const wrapper = render({ items: [{ label: 'A' }] }, rows(), {
      [metricFieldKey(0)]: { state: 'error', message: '快照读不到' },
    })

    expect(wrapper.get('.metric-cell').attributes('title')).toContain(
      '快照读不到',
    )
  })

  it('有读数的格子不挂 title，也不画状态标签', () => {
    const wrapper = render({ items: [{ label: 'A', precision: 0 }] }, rows(7), {
      [metricFieldKey(0)]: OK,
    })

    expect(wrapper.get('.metric-cell').attributes('title')).toBeUndefined()
    expect(wrapper.find('.metric-cell__state').exists()).toBe(false)
    expect(wrapper.get('.metric-cell__value').text()).toBe('7')
  })

  it('更新时刻默认不画，开了才有', () => {
    const one = { items: [{ label: 'A' }] }

    expect(
      render(one, rows(1), { [metricFieldKey(0)]: OK })
        .find('.metric-cell__time')
        .exists(),
    ).toBe(false)
    expect(
      render({ ...one, showUpdatedAt: true }, rows(1), {
        [metricFieldKey(0)]: OK,
      })
        .get('.metric-cell__time')
        .text(),
    ).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('有读数时画单位，跟在读数后面', () => {
    const wrapper = render(
      { items: [{ label: '电压', unit: 'kV', precision: 2 }] },
      rows(10.4),
      { [metricFieldKey(0)]: OK },
    )

    expect(wrapper.get('.metric-cell__unit').text()).toBe('kV')
    expect(wrapper.get('.metric-cell__value').text()).toContain('10.40')
  })

  it('命中阈值的格子改用严重度色，并写明越了哪一侧', () => {
    const wrapper = render(
      { items: [{ label: '温度', warnAbove: 80, dangerAbove: 95 }] },
      rows(99),
      { [metricFieldKey(0)]: OK },
    )

    expect(wrapper.get('.metric-cell__value').attributes('style')).toContain(
      'var(--state-danger)',
    )
    expect(wrapper.get('.metric-cell__hit').text()).toBe('过高')
  })

  it('没告警的格子用配置的读数颜色，不被严重度色顶掉', () => {
    const wrapper = render(
      { items: [{ label: '温度', warnAbove: 80 }], valueColor: 'var(--x)' },
      rows(20),
      { [metricFieldKey(0)]: OK },
    )

    expect(wrapper.get('.metric-cell__value').attributes('style')).toContain(
      'var(--x)',
    )
  })

  it('状态点只画给配过阈值边界的格子', () => {
    const items = [{ label: 'A' }, { label: 'B', warnAbove: 10 }]
    const wrapper = render({ items }, rows(1, 2), {
      [metricFieldKey(0)]: OK,
      [metricFieldKey(1)]: OK,
    })

    expect(wrapper.findAll('.metric-cell__dot')).toHaveLength(1)
  })

  it('状态点可以整体关掉', () => {
    const wrapper = render(
      { items: [{ label: 'B', warnAbove: 10 }], showStatusDot: false },
      rows(2),
      { [metricFieldKey(0)]: OK },
    )

    expect(wrapper.find('.metric-cell__dot').exists()).toBe(false)
  })
})

describe('实时数值的联动上抛', () => {
  /** 挂进真实文档并盯住冒泡到宿主那一层的点击。 */
  function clickCell(items: unknown[]) {
    const onHost = vi.fn()
    document.body.addEventListener('click', onHost)
    const wrapper = mount(Component, {
      attachTo: document.body,
      props: {
        config: { ...configDefaults(manifest.configSchema), items },
        values: rows(1),
        meta: { slots: { [metricFieldKey(0)]: OK } },
      },
    })

    wrapper
      .get('.metric-cell')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.body.removeEventListener('click', onHost)
    const emitted = wrapper.emitted('interaction')
    wrapper.unmount()
    return { onHost, emitted }
  }

  it('配了联动值的格子上抛这一格的值，并吞掉冒泡', () => {
    const { onHost, emitted } = clickCell([{ label: 'A', key: 'unit-1' }])

    expect(emitted?.[0]).toEqual([{ event: 'click', value: 'unit-1' }])
    // 不吞的话宿主的「整块可点」会再抛一个没有 value 的 click，toggle 自我抵消
    expect(onHost).not.toHaveBeenCalled()
  })

  it('没配联动值就不抛，也不吞冒泡——那时整块可点才是唯一落点', () => {
    const { onHost, emitted } = clickCell([{ label: 'A' }])

    expect(emitted).toBeUndefined()
    expect(onHost).toHaveBeenCalledTimes(1)
  })
})
