/**
 * @fileoverview 守信息卡片整块的渲染：标题走共用面板、网格只由 `gridStyle` 一处下发、
 * 格与配置项按文档序一一缝合、逐格四档各自出（十格里坏一格不牵连另外九格）、
 * 联动值上抛，以及一格都没配时的空态。
 *
 * ⚠ 「排布自动」这一档要等格数出来才判得了：先读形态再算格的话，一格的卡片也会被
 * 摆成网格——屏上只是大字变小了，没人会把它当 bug 报上来。
 * ⚠ 逐格四档在 `values` 里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/info-card/Component.vue'
import {
  CARD_SLOT_KEY,
  cardFieldKey,
} from '../../../src/modules/info-card/cells'
import manifest from '../../../src/modules/info-card/manifest'
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

/** 注入袋：逐格的主读数，按文档序。 */
function readings(...values: unknown[]): Record<string, unknown> {
  return { [CARD_SLOT_KEY]: values.map((value) => ({ value })) }
}

function texts(wrapper: Rendered, selector: string): string[] {
  return wrapper.findAll(selector).map((node) => node.text())
}

const THREE = [
  { label: '温度', unit: '℃', precision: 1 },
  { label: '湿度', unit: '%', precision: 0 },
  { label: '气压', unit: 'hPa', precision: 0 },
]

describe('信息卡片的骨架', () => {
  it('标题交给共用面板，留空则整条标题栏不出', () => {
    const titled = render({ title: '气象观测' })

    expect(titled.find('.module-panel').exists()).toBe(true)
    expect(titled.text()).toContain('气象观测')
    expect(render().find('.module-title-bar').exists()).toBe(false)
  })

  it('网格只由一处下发：列模板、格间距与整块内边距全在根的内联样式里', () => {
    const wrapper = render({
      items: THREE,
      columns: '3',
      gapX: 12,
      gapY: 8,
      padX: 14,
      padY: 4,
    })
    const style = wrapper.get('.ic-card').attributes('style') ?? ''

    expect(style).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(style).toContain('gap: 8px 12px')
    expect(style).toContain('padding: 4px 14px')
  })

  it('列数自动那一档按最小列宽自适应铺满', () => {
    const style =
      render({ items: THREE }).get('.ic-card').attributes('style') ?? ''

    expect(style).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))',
    )
  })

  it('格与配置项按文档序一一缝合，注入袋的第 N 项喂第 N 格', () => {
    const wrapper = render({ items: THREE }, readings(23.4, 61, 1013))

    expect(texts(wrapper, '.ic-label')).toEqual(['温度', '湿度', '气压'])
    expect(texts(wrapper, '.ic-value')).toEqual(['23.4', '61', '1013'])
    expect(texts(wrapper, '.ic-unit')).toEqual(['℃', '%', 'hPa'])
  })

  it('档位类一份挂在卡片根上，格自己也吃同一份', () => {
    const wrapper = render({ items: THREE, cellShell: 'card', hover: 'tint' })
    const card = wrapper.get('.ic-card')

    expect(card.classes()).toContain('ic--shell-card')
    expect(card.classes()).toContain('ic--hover-tint')
    expect(wrapper.get('.ic-cell').classes()).toContain('ic--shell-card')
  })
})

describe('排布自动那一档', () => {
  it('只有一格时走单格大字', () => {
    const wrapper = render({ items: [{ label: '总产热' }] })

    expect(wrapper.get('.ic-card').classes()).toContain('ic--layout-single')
    expect(wrapper.get('.ic-card').attributes('style') ?? '').toContain(
      'grid-template-columns: minmax(0, 1fr)',
    )
  })

  it('多格时走网格', () => {
    expect(render({ items: THREE }).get('.ic-card').classes()).toContain(
      'ic--layout-grid',
    )
  })

  it('钉死了排布档就不再看格数', () => {
    const single = render({ items: THREE, layout: 'single' })
    const grid = render({ items: [{ label: '总产热' }], layout: 'grid' })

    expect(single.get('.ic-card').classes()).toContain('ic--layout-single')
    expect(grid.get('.ic-card').classes()).toContain('ic--layout-grid')
  })
})

describe('逐格四档', () => {
  const slots = (): Slots => ({
    [cardFieldKey(0, 'value')]: { state: 'ok' },
    [cardFieldKey(1, 'value')]: { state: 'error', message: '点位不存在' },
    [cardFieldKey(2, 'value')]: { state: 'pending' },
  })

  it('坏掉的那一格自己交代，另外两格照常出读数', () => {
    const wrapper = render({ items: THREE }, readings(23.4), slots())
    const values = wrapper.findAll('.ic-value')

    expect(values[0]?.classes()).toEqual(['ic-value'])
    expect(values[1]?.classes()).toContain('ic-value--error')
    expect(values[2]?.classes()).toContain('ic-value--pending')
  })

  it('没有值的那一格把完整原因挂 title，屏上只留一个占位符', () => {
    const wrapper = render({ items: THREE }, readings(23.4), slots())
    const broken = wrapper.findAll('.ic-value')[1]

    expect(broken?.text()).toBe('—')
    expect(broken?.attributes('title')).toBe('取不到：点位不存在')
  })

  it('没下发逐槽结论时只退回「有没有值」这一条判据', () => {
    const wrapper = render({ items: THREE }, readings(23.4))
    const values = wrapper.findAll('.ic-value')

    expect(values[0]?.classes()).toEqual(['ic-value'])
    expect(values[1]?.classes()).toContain('ic-value--unbound')
  })
})

describe('点一格', () => {
  it('配了联动值的格上抛这一格的值', async () => {
    const wrapper = render(
      { items: [{ label: '一号机', emitValue: 'u1' }] },
      readings(12),
    )
    await wrapper.get('.ic-cell').trigger('click')

    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'click', value: 'u1' }],
    ])
  })

  it('没配联动值的格点了不上抛，也不吞冒泡——整块可点由宿主兜底', async () => {
    const spy = vi.fn()
    document.body.addEventListener('click', spy)
    const wrapper = mount(Component, {
      attachTo: document.body,
      props: {
        config: { ...DEFAULTS, items: [{ label: '一号机' }] },
        values: readings(12),
      },
    })
    await wrapper.get('.ic-cell').trigger('click')

    expect(wrapper.emitted('interaction')).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    document.body.removeEventListener('click', spy)
  })
})

describe('一格都没配', () => {
  it('给一句话而不是留一整块空白，网格本身也不画', () => {
    const wrapper = render({ items: [] })

    expect(wrapper.get('.ic-empty').text()).toBe('未配置指标项')
    expect(wrapper.find('.ic-card').exists()).toBe(false)
  })
})
