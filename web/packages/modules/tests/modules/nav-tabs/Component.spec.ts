/**
 * @fileoverview 守页签栏的渲染与上抛契约：点一格带值上抛「选项点击」、
 * 没配联动值的格只挪高亮不上抛、禁用格两样都不做、选中态跟着配置里的
 * 「默认选中」走（宿主推出来的「当前这张屏那一格」赢过它），以及每一格都是原生
 * button（键盘、焦点与读屏全靠它）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/nav-tabs/Component.vue'
import manifest from '../../../src/modules/nav-tabs/manifest'
import { configDefaults } from '../../../src/shared/config'

const THREE_TABS = [
  { label: '总览', emitValue: 'overview' },
  { label: '能耗', emitValue: 'energy' },
  { label: '设备', emitValue: 'device' },
]

function render(config: Record<string, unknown> = {}, activeValue?: string) {
  return mount(Component, {
    props: {
      config,
      values: {},
      ...(activeValue === undefined ? {} : { meta: { activeValue } }),
    },
  })
}

/** 按清单缺省摊一份完整配置，与属性面板里没动过任何旋钮时一致。 */
function renderDefaults(extra: Record<string, unknown> = {}) {
  return render({ ...configDefaults(manifest.configSchema), ...extra })
}

function interactions(wrapper: ReturnType<typeof render>): unknown[] {
  return wrapper.emitted('interaction') ?? []
}

function activeLabels(wrapper: ReturnType<typeof render>): string[] {
  return wrapper
    .findAll('button')
    .filter((button) => button.attributes('aria-pressed') === 'true')
    .map((button) => button.text())
}

describe('页签栏的骨架', () => {
  it('一格一个原生 button：键盘、焦点与读屏角色都靠它', () => {
    const buttons = render({ items: THREE_TABS }).findAll('button')

    expect(buttons).toHaveLength(3)
    expect(buttons[0]?.attributes('type')).toBe('button')
  })

  it('出厂配置就是三格，拖进画布不是一条空轨道', () => {
    expect(renderDefaults().findAll('button')).toHaveLength(3)
  })

  it('配了图标才画图标，尺寸跟着字号走', () => {
    const wrapper = render({
      items: [{ label: '总览', icon: 'gauge' }, { label: '能耗' }],
      fontSize: 20,
    })

    expect(wrapper.findAll('svg')).toHaveLength(1)
    expect(wrapper.get('svg').attributes('width')).toBe('22')
  })

  it('外观旋钮落成轨道自己的 CSS 变量，不改全局', () => {
    const style = renderDefaults({ fontSize: 22 })
      .get('.dt-tabs')
      .attributes('style')

    expect(style).toContain('--tab-font-size: 22px')
    expect(style).toContain('--tab-accent: var(--accent-primary)')
  })
})

describe('页签栏的选中态', () => {
  it('开屏高亮「默认选中」那一格', () => {
    expect(activeLabels(render({ items: THREE_TABS, activeIndex: 2 }))).toEqual(
      ['能耗'],
    )
  })

  it('点一格就把高亮挪过去，同时只有一格是选中的', async () => {
    const wrapper = render({ items: THREE_TABS })
    await wrapper.findAll('button')[2]?.trigger('click')

    expect(activeLabels(wrapper)).toEqual(['设备'])
  })

  it('改了「默认选中」就回到配置那一档，不停在上次点过的格上', async () => {
    const wrapper = render({ items: THREE_TABS })
    await wrapper.findAll('button')[2]?.trigger('click')
    await wrapper.setProps({ config: { items: THREE_TABS, activeIndex: 2 } })

    expect(activeLabels(wrapper)).toEqual(['能耗'])
  })

  // 宿主拿本节点的按值跳转规则跟当前这张屏比出来的那一格。一条页签栏原样摆到
  // 每张屏上，配置里的静态下标只对其中一张是对的，全靠这一档纠正
  it('宿主说当前在哪一格，就高亮哪一格，不看「默认选中」', () => {
    const wrapper = render({ items: THREE_TABS, activeIndex: 3 }, 'energy')

    expect(activeLabels(wrapper)).toEqual(['能耗'])
  })

  it('宿主给的值不在任何一格上时回落「默认选中」', () => {
    const wrapper = render({ items: THREE_TABS, activeIndex: 3 }, '不认识')

    expect(activeLabels(wrapper)).toEqual(['设备'])
  })

  it('刚点过的那一格赢过宿主推的那一格：跳转在途时先给出反馈', async () => {
    const wrapper = render({ items: THREE_TABS }, 'overview')
    await wrapper.findAll('button')[1]?.trigger('click')

    expect(activeLabels(wrapper)).toEqual(['能耗'])
  })

  it('宿主换了一张屏就回到它推的那一格，不停在上次点过的格上', async () => {
    const wrapper = render({ items: THREE_TABS }, 'overview')
    await wrapper.findAll('button')[1]?.trigger('click')
    await wrapper.setProps({ meta: { activeValue: 'device' } })

    expect(activeLabels(wrapper)).toEqual(['设备'])
  })

  it('点过之后把格删到更少时高亮回落配置档，不会落在空处', async () => {
    const wrapper = render({ items: THREE_TABS })
    await wrapper.findAll('button')[2]?.trigger('click')
    await wrapper.setProps({ config: { items: THREE_TABS.slice(0, 2) } })

    expect(activeLabels(wrapper)).toEqual(['总览'])
  })
})

describe('页签栏的上抛', () => {
  it('点一格上抛「选项点击」并带上这一格的联动值', async () => {
    const wrapper = render({ items: THREE_TABS })
    await wrapper.findAll('button')[1]?.trigger('click')

    expect(interactions(wrapper)).toEqual([
      [{ event: 'select', value: 'energy' }],
    ])
  })

  it('没配联动值的格只挪高亮不上抛：没有值的事件命不中任何一条按值分派的规则', async () => {
    const wrapper = render({ items: [{ label: '总览' }, { label: '能耗' }] })
    await wrapper.findAll('button')[1]?.trigger('click')

    expect(interactions(wrapper)).toEqual([])
    expect(activeLabels(wrapper)).toEqual(['能耗'])
  })

  it('禁用格既不上抛也不挪高亮，disabled 属性挡真人、这一道挡程序派发的事件', async () => {
    const wrapper = render({
      items: [
        { label: '总览', emitValue: 'overview' },
        { label: '能耗', emitValue: 'energy', disabled: true },
      ],
    })
    await wrapper.findAll('button')[1]?.trigger('click')

    expect(interactions(wrapper)).toEqual([])
    expect(activeLabels(wrapper)).toEqual(['总览'])
    expect(wrapper.findAll('button')[1]?.attributes('disabled')).toBeDefined()
  })

  it('改了联动值之后抛的是新值，不是挂载那一刻的值', async () => {
    const wrapper = render({ items: [{ label: '总览', emitValue: '旧' }] })
    await wrapper.setProps({
      config: { items: [{ label: '总览', emitValue: '新' }] },
    })
    await wrapper.get('button').trigger('click')

    expect(interactions(wrapper)).toEqual([[{ event: 'select', value: '新' }]])
  })
})
