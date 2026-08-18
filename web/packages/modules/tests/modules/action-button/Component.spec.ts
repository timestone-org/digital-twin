/**
 * @fileoverview 守按钮的渲染与上抛契约：点击带不带值两条路各一条、禁用一律不上抛、
 * 用的是原生 button（键盘与读屏全靠它），以及只摆图标时读屏拿得到名字。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/action-button/Component.vue'
import manifest from '../../../src/modules/action-button/manifest'
import { configDefaults } from '../../../src/shared/config'

function render(config: Record<string, unknown> = {}) {
  return mount(Component, { props: { config, values: {} } })
}

/** 按清单缺省摊一份完整配置，与属性面板里没动过任何旋钮时一致。 */
function renderDefaults(extra: Record<string, unknown> = {}) {
  return render({ ...configDefaults(manifest.configSchema), ...extra })
}

function interactions(wrapper: ReturnType<typeof render>): unknown[] {
  return wrapper.emitted('interaction') ?? []
}

describe('按钮的骨架', () => {
  it('渲染的是原生 button：键盘、焦点与读屏角色都靠它', () => {
    const button = renderDefaults().get('button')

    expect(button.attributes('type')).toBe('button')
  })

  it('文案与副文案各占一行，副文案留空就不画', () => {
    const wrapper = render({ text: '进入详情', subText: 'DETAIL' })

    expect(wrapper.get('.dt-button__text').text()).toBe('进入详情')
    expect(wrapper.get('.dt-button__sub').text()).toBe('DETAIL')
    expect(render({ text: '进入详情' }).find('.dt-button__sub').exists()).toBe(
      false,
    )
  })

  it('配了图标才画图标，尺寸跟着字号走', () => {
    const wrapper = render({ icon: 'arrow-right', fontSize: 20 })

    expect(wrapper.get('svg').attributes('width')).toBe('24')
    expect(render({}).find('svg').exists()).toBe(false)
  })

  it('只有科技风画四角刻线，只有扫光档摆动画层', () => {
    expect(render({ variant: 'hud' }).find('.dt-button__deco').exists()).toBe(
      true,
    )
    expect(render({}).find('.dt-button__deco').exists()).toBe(false)
    expect(render({ hover: 'sweep' }).find('.dt-button__sweep').exists()).toBe(
      true,
    )
  })

  it('外观旋钮落成按钮自己的 CSS 变量，不改全局', () => {
    const style = renderDefaults({ fontSize: 24 })
      .get('button')
      .attributes('style')

    expect(style).toContain('--btn-font-size: 24px')
    expect(style).toContain('--btn-accent: var(--accent-primary)')
  })
})

describe('按钮的上抛', () => {
  it('没配联动值时抛一个不带值的点击——显隐与弹窗要的就是这个形状', async () => {
    const wrapper = render({})
    await wrapper.get('button').trigger('click')

    expect(interactions(wrapper)).toEqual([[{ event: 'click' }]])
  })

  it('配了联动值就带上它，按值分流的动作靠它挑路', async () => {
    const wrapper = render({ linkValue: 'line-1' })
    await wrapper.get('button').trigger('click')

    expect(interactions(wrapper)).toEqual([
      [{ event: 'click', value: 'line-1' }],
    ])
  })

  it('禁用时一次都不上抛：disabled 属性挡真人，这一道挡程序派发的事件', async () => {
    const wrapper = render({ disabled: true, linkValue: 'line-1' })
    await wrapper.get('button').trigger('click')

    expect(interactions(wrapper)).toEqual([])
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('改了联动值之后抛的是新值，不是挂载那一刻的值', async () => {
    const wrapper = render({ linkValue: '旧' })
    await wrapper.setProps({ config: { linkValue: '新' } })
    await wrapper.get('button').trigger('click')

    expect(interactions(wrapper)).toEqual([[{ event: 'click', value: '新' }]])
  })
})

describe('按钮的可访问性', () => {
  it('有文案时不写 aria-label：它会盖掉屏幕上写的字', () => {
    expect(
      render({ text: '进入详情' }).get('button').attributes('aria-label'),
    ).toBeUndefined()
  })

  it('只摆图标时读屏拿到的是悬停提示', () => {
    const button = render({ text: '', icon: 'home', hint: '返回总览' }).get(
      'button',
    )

    expect(button.attributes('aria-label')).toBe('返回总览')
    expect(button.attributes('title')).toBe('返回总览')
  })

  it('没填提示就不挂 title，免得悬停弹出一个空气泡', () => {
    expect(render({}).get('button').attributes('title')).toBeUndefined()
  })
})
