/**
 * @fileoverview 守仪表卡片整块的渲染：标题走共用面板、网格只由 `gridStyle` 一处下发、
 * 仪表与配置项按文档序一一缝合、逐个四档各自出（六个里坏一个不牵连另外五个）、
 * 读数三处各自的落点、联动值上抛与条件吞冒泡，以及一个都没配时的空态。
 *
 * ⚠ 「排布自动」这一档要等仪表个数出来才判得了：先读形态再算仪表的话，一个仪表的卡片
 * 也会被摆成网格——屏上只是图形变小了，没人会把它当缺陷报上来。
 * ⚠ 逐个四档在 `values` 里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 读数摆图形中央那一档在 DOM 里是 `GaugeShape` 的居中层，另外两档是它的兄弟节点：
 * 两处摆错不会报错，只是读数压不到图形上或被量程端点顶偏。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/gauge-card/Component.vue'
import {
  GAUGE_SLOT_KEY,
  gaugeFieldKey,
} from '../../../src/modules/gauge-card/gauges'
import manifest from '../../../src/modules/gauge-card/manifest'
import { configDefaults } from '../../../src/shared/config'

const DEFAULTS = configDefaults(manifest.configSchema)

type Slots = Record<string, ModuleSlotMeta>

function render(
  config: Record<string, unknown> = {},
  values: Record<string, unknown> = {},
  slots?: Slots,
) {
  return mount(Component, {
    props: {
      config: { ...DEFAULTS, ...config },
      values,
      ...(slots === undefined ? {} : { meta: { slots } }),
    },
  })
}

type Rendered = ReturnType<typeof render>

/** 注入袋：逐个仪表的主读数，按文档序。 */
function readings(...values: unknown[]): Record<string, unknown> {
  return { [GAUGE_SLOT_KEY]: values.map((value) => ({ value })) }
}

function texts(wrapper: Rendered, selector: string): string[] {
  return wrapper.findAll(selector).map((node) => node.text())
}

function classesOf(wrapper: Rendered, selector: string): string[] {
  return wrapper.get(selector).classes()
}

const THREE = [
  { label: '进水温度', unit: '℃', precision: 1, min: 0, max: 80 },
  { label: '出水温度', unit: '℃', precision: 1, min: 0, max: 80 },
  { label: '流量', unit: 'm³/h', precision: 0, min: 0, max: 200 },
]

describe('仪表卡片的骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', () => {
    const titled = render({ title: '一次侧运行' })

    expect(titled.find('.module-panel').exists()).toBe(true)
    expect(titled.text()).toContain('一次侧运行')
    expect(render().find('.module-title-bar').exists()).toBe(false)
  })

  it('网格只由一处下发：列模板、仪表间距与整块内边距全在根的内联样式里', () => {
    const wrapper = render({
      items: THREE,
      layout: 'grid',
      columns: '3',
      gap: 12,
      padX: 14,
      padY: 4,
    })
    const style = wrapper.get('.gc-grid').attributes('style') ?? ''

    expect(style).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(style).toContain('gap: 12px')
    expect(style).toContain('padding: 4px 14px')
  })

  it('排布自动这一档要等仪表个数出来才判得了', () => {
    const one = render({ items: [THREE[0]] }).get('.gc-grid')
    const many = render({ items: THREE }).get('.gc-grid')

    expect(one.attributes('style')).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
    expect(many.attributes('style')).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))',
    )
  })

  it('一个仪表都没配时给一句话，而不是一块空白', () => {
    const wrapper = render({ items: [] })

    expect(wrapper.find('.gc-grid').exists()).toBe(false)
    expect(wrapper.get('.gc-empty').text()).toBe('未配置仪表')
  })

  it('整块的档位类与变量逐个摊在仪表上，一个仪表能脱开容器单独挂载', () => {
    const wrapper = render(
      { items: THREE, shape: 'tank', fillStyle: 'gradient', valueGlow: 8 },
      readings(40, 50, 60),
    )
    const cell = wrapper.get('.gc-cell')

    expect(cell.classes()).toEqual(
      expect.arrayContaining([
        'gc--layout-grid',
        'gc--shape-tank',
        'gc--fill-gradient',
        'gc--read-center',
        'gc--unit-baseline',
      ]),
    )
    expect(cell.attributes('style')).toContain('--gc-value-glow: 8px')
  })

  it('逐个仪表的固定颜色摊在它自己身上，不牵连同一块里的别人', () => {
    const wrapper = render(
      {
        items: [{ ...THREE[0], color: 'var(--state-danger)' }, THREE[1]],
      },
      readings(20, 30),
    )
    const cells = wrapper.findAll('.gc-cell')

    expect(cells[0]?.attributes('style')).toContain(
      '--gc-item-color: var(--state-danger)',
    )
    expect(cells[1]?.attributes('style')).not.toContain('--gc-item-color')
  })
})

describe('仪表与配置项按文档序缝合', () => {
  it('第 N 个仪表读第 N 行注入的值', () => {
    const wrapper = render({ items: THREE }, readings(36.5, 41.2, 128))

    expect(texts(wrapper, '.gc-value')).toEqual(['36.5', '41.2', '128'])
    expect(texts(wrapper, '.gc-label')).toEqual([
      '进水温度',
      '出水温度',
      '流量',
    ])
  })

  it('单位与量程百分比跟在读数之后，只有有值的那一档才画', () => {
    const wrapper = render({ items: [THREE[0]], readout: 'both' }, readings(40))

    expect(wrapper.get('.gc-unit').text()).toBe('℃')
    expect(wrapper.get('.gc-percent').text()).toBe('(50%)')
  })

  it('读数不显示且没配名称时整组读数不渲染，图形不被一行空行高顶偏', () => {
    const wrapper = render(
      { items: [{ unit: '℃', min: 0, max: 80 }], readout: 'none' },
      readings(40),
    )

    expect(wrapper.find('.gc-readout').exists()).toBe(false)
    expect(wrapper.find('.gc-shape').exists()).toBe(true)
  })

  it('读数不显示但配了名称时，标签那一行照旧留着', () => {
    const wrapper = render({ items: [THREE[0]], readout: 'none' }, readings(40))

    expect(wrapper.get('.gc-readout').text()).toBe('进水温度')
    expect(wrapper.find('.gc-read').exists()).toBe(false)
  })
})

describe('逐个仪表的四档', () => {
  const ITEMS = [THREE[0], THREE[1]]

  function slotsOf(states: readonly ModuleSlotMeta['state'][]): Slots {
    const slots: Slots = {}
    states.forEach((state, index) => {
      slots[gaugeFieldKey(index, 'value')] = { state }
    })
    return slots
  }

  it('坏掉一个不牵连另一个：一个显原因、另一个照常出数', () => {
    const wrapper = render(
      { items: ITEMS },
      { [GAUGE_SLOT_KEY]: [{}, { value: 44 }] },
      slotsOf(['error', 'ok']),
    )
    const values = wrapper.findAll('.gc-value')

    expect(values[0]?.classes()).toContain('gc-value--error')
    expect(values[0]?.text()).toBe('—')
    expect(values[1]?.classes()).not.toContain('gc-value--error')
    expect(values[1]?.text()).toBe('44')
  })

  it('等首帧与没配来源是两个类，占位符是同一个字', () => {
    const wrapper = render(
      { items: ITEMS },
      { [GAUGE_SLOT_KEY]: [] },
      slotsOf(['pending']),
    )
    const values = wrapper.findAll('.gc-value')

    expect(values[0]?.classes()).toContain('gc-value--pending')
    expect(values[1]?.classes()).toContain('gc-value--unbound')
    expect(texts(wrapper, '.gc-value')).toEqual(['—', '—'])
  })

  it('没有值的那一句完整原因挂在读数的 title 上，有值时不留空提示', () => {
    const wrapper = render(
      { items: ITEMS },
      { [GAUGE_SLOT_KEY]: [{}, { value: 44 }] },
      {
        [gaugeFieldKey(0, 'value')]: {
          state: 'error',
          message: '点位已删除',
        },
        [gaugeFieldKey(1, 'value')]: { state: 'ok' },
      },
    )
    const values = wrapper.findAll('.gc-value')

    expect(values[0]?.attributes('title')).toBe('取不到：点位已删除')
    expect(values[1]?.attributes('title')).toBeUndefined()
  })

  it('单位只在有读数那一档画——「— ℃」看着像是有读数的', () => {
    const wrapper = render(
      { items: [THREE[0]] },
      { [GAUGE_SLOT_KEY]: [{}] },
      slotsOf(['error']),
    )

    expect(wrapper.find('.gc-unit').exists()).toBe(false)
  })
})

describe('读数三处的落点', () => {
  const ONE = [THREE[0]]

  it('摆图形中央那一档塞进图形的居中层', () => {
    const wrapper = render({ items: ONE, readoutPlace: 'center' }, readings(40))

    expect(wrapper.find('.gc-center .gc-readout').exists()).toBe(true)
    expect(wrapper.findAll('.gc-readout')).toHaveLength(1)
  })

  it('摆旁边与摆下方那两档是图形的兄弟节点，居中层整件不画', () => {
    for (const place of ['beside', 'below']) {
      const wrapper = render({ items: ONE, readoutPlace: place }, readings(40))

      expect(wrapper.find('.gc-center').exists()).toBe(false)
      expect(wrapper.find('.gc-cell > .gc-readout').exists()).toBe(true)
      expect(wrapper.get('.gc-cell').classes()).toContain(`gc--read-${place}`)
    }
  })

  it('读数在 DOM 里恒排在图形之前，读屏先念数', () => {
    const wrapper = render({ items: ONE, readoutPlace: 'below' }, readings(40))
    const kids = wrapper.get('.gc-cell').element.children

    expect(kids[0]?.className).toContain('gc-readout')
    expect(kids[1]?.className).toContain('gc-shape')
  })
})

describe('标签位置的类只在标签真渲染时才挂', () => {
  it('配了名称就挂当前档位', () => {
    const wrapper = render(
      { items: [THREE[0]], labelPlace: 'left' },
      readings(40),
    )

    expect(classesOf(wrapper, '.gc-cell')).toContain('gc-cell--label-left')
  })

  it('名称留空就一个档位类都不挂，免得多出一列空位', () => {
    const wrapper = render(
      { items: [{ unit: '℃', min: 0, max: 80 }], labelPlace: 'left' },
      readings(40),
    )

    expect(
      classesOf(wrapper, '.gc-cell').filter((name) =>
        name.startsWith('gc-cell--label-'),
      ),
    ).toEqual([])
  })

  it('命中规则的文案顶掉名称，颜色跟着填充色走', () => {
    const wrapper = render(
      {
        items: [THREE[0]],
        rules: [{ op: 'gt', value: 30, level: 'danger', label: '超温' }],
      },
      readings(40),
    )

    expect(wrapper.get('.gc-label').classes()).toContain('gc-label--hit')
    expect(wrapper.get('.gc-label').text()).toBe('超温')
  })

  it('命中带闪烁的规则时读数挂上闪烁类', () => {
    const wrapper = render(
      {
        items: [THREE[0]],
        rules: [{ op: 'gt', value: 30, level: 'danger', blink: true }],
      },
      readings(40),
    )

    expect(wrapper.get('.gc-value').classes()).toContain('gc-value--blink')
  })
})

describe('点一个仪表上抛它的联动值', () => {
  it('配了联动值就上抛并吞掉冒泡', async () => {
    const wrapper = render(
      { items: [{ ...THREE[0], emitValue: 'ROOM-1' }] },
      readings(40),
    )
    const cell = wrapper.get('.gc-cell')

    expect(cell.classes()).toContain('gc-cell--pick')
    await cell.trigger('click')

    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'click', value: 'ROOM-1' }],
    ])
  })

  it('没配联动值就不上抛、也不吞冒泡，让整块可点兜底', async () => {
    const wrapper = render({ items: [THREE[0]] }, readings(40))
    const cell = wrapper.get('.gc-cell')

    expect(cell.classes()).not.toContain('gc-cell--pick')
    await cell.trigger('click')

    expect(wrapper.emitted('interaction')).toBeUndefined()
  })

  it('吞冒泡是有条件的：只有配了联动值的那一次才拦下来', () => {
    const withValue = render(
      { items: [{ ...THREE[0], emitValue: 'ROOM-1' }] },
      readings(40),
    )
    const without = render({ items: [THREE[0]] }, readings(40))
    const stopped: boolean[] = []

    for (const wrapper of [withValue, without]) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      let seen = false
      event.stopPropagation = (): void => {
        seen = true
      }
      wrapper.get('.gc-cell').element.dispatchEvent(event)
      stopped.push(seen)
    }

    expect(stopped).toEqual([true, false])
  })
})
