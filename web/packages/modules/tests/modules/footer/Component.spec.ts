/**
 * @fileoverview 守页脚的渲染契约：子节点走默认插槽（插槽名写错既不报错也不渲染）、
 * 缺 `showTitle` 时不画标题条，以及「空配置」与「清单缺省摊出来的配置」渲染逐字相同。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/footer/Component.vue'
import footerManifest from '../../../src/modules/footer/manifest'
import { configDefaults } from '../../../src/shared/config'
import { resolveContentInset } from '../../../src/shared/container'

const CHILD = '<b class="child">版权子节点</b>'

function render(config: Record<string, unknown>) {
  return mount(Component, {
    props: { config, values: {} },
    slots: { default: CHILD },
  })
}

describe('页脚外壳', () => {
  it('子节点渲染在默认插槽里', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-footer__content .child').text()).toBe('版权子节点')
  })

  it('空配置不画标题条', () => {
    const wrapper = render({})

    expect(wrapper.find('.dt-footer__bar').exists()).toBe(false)
  })

  it('开了标题条才画，并显示标题文字', () => {
    const wrapper = render({ showTitle: true, title: '运行状态' })

    expect(wrapper.get('.dt-footer__title').text()).toBe('运行状态')
  })

  it('开了标题条但没填标题时条还在，只是没有文字', () => {
    const wrapper = render({ showTitle: true })

    expect(wrapper.get('.dt-footer__title').text()).toBe('')
  })

  it('标题条的显隐与内容区内缩算的是同一件事', () => {
    const config = { showTitle: true }

    expect(render(config).find('.dt-footer__bar').exists()).toBe(true)
    expect(resolveContentInset(config).top).toBe(36)
  })

  it('空配置与清单缺省摊出来的配置渲染逐字相同', () => {
    const fromEmpty = render({}).html()
    const fromDefaults = render(configDefaults(footerManifest.configSchema))

    expect(fromDefaults.html()).toBe(fromEmpty)
  })
})

describe('页脚外观', () => {
  it('内边距落到内容区', () => {
    const wrapper = render({ __container: { pad: 20 } })

    expect(wrapper.get('.dt-footer__content').attributes('style')).toContain(
      'padding: 20px',
    )
  })

  it('缺内部布局时用缺省内边距', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-footer__content').attributes('style')).toContain(
      'padding: 8px',
    )
  })

  it('强调色写进外壳的自定义属性', () => {
    const wrapper = render({ accent: 'var(--state-warning)' })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      '--dt-footer-accent: var(--state-warning)',
    )
  })

  it('强调色留空时回落主色，而不是把变量注入成空值', () => {
    const wrapper = render({ accent: 42 })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      '--dt-footer-accent: var(--accent-primary)',
    )
  })

  it('背景留空时不写背景样式', () => {
    const wrapper = render({ background: '' })

    expect(wrapper.get('.dt-footer').attributes('style')).not.toContain(
      'background',
    )
  })

  it('填了背景才写背景样式', () => {
    const wrapper = render({ background: 'var(--surface-panel)' })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      'background: var(--surface-panel)',
    )
  })
})
