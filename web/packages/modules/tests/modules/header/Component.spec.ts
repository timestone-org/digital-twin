/**
 * @fileoverview 守页头的渲染契约：子节点走默认插槽（插槽名写错既不报错也不渲染）、
 * 缺 `showTitle` 时不画标题条，以及「空配置」与「清单缺省摊出来的配置」渲染逐字相同——
 * 两份缺省一旦漂，表现是同一张大屏在新建与重载之后长得不一样。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/header/Component.vue'
import headerManifest from '../../../src/modules/header/manifest'
import { configDefaults } from '../../../src/shared/config'

const CHILD = '<b class="child">时钟子节点</b>'

function render(config: Record<string, unknown>) {
  return mount(Component, {
    props: { config, values: {} },
    slots: { default: CHILD },
  })
}

describe('页头外壳', () => {
  it('子节点渲染在默认插槽里', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-header__content .child').text()).toBe('时钟子节点')
  })

  it('空配置不画标题条', () => {
    const wrapper = render({})

    expect(wrapper.find('.dt-header__bar').exists()).toBe(false)
  })

  it('开了标题条才画，并显示标题文字', () => {
    const wrapper = render({ showTitle: true, title: '光伏大屏' })

    expect(wrapper.get('.dt-header__title').text()).toBe('光伏大屏')
  })

  it('开了标题条但没填标题时条还在，只是没有文字', () => {
    const wrapper = render({ showTitle: true })

    expect(wrapper.get('.dt-header__title').text()).toBe('')
  })

  it('空配置与清单缺省摊出来的配置渲染逐字相同', () => {
    const fromEmpty = render({}).html()
    const fromDefaults = render(configDefaults(headerManifest.configSchema))

    expect(fromDefaults.html()).toBe(fromEmpty)
  })
})

describe('页头外观', () => {
  it('内边距落到内容区', () => {
    const wrapper = render({ __container: { pad: 20 } })

    expect(wrapper.get('.dt-header__content').attributes('style')).toContain(
      'padding: 20px',
    )
  })

  it('缺内部布局时用缺省内边距', () => {
    const wrapper = render({})

    expect(wrapper.get('.dt-header__content').attributes('style')).toContain(
      'padding: 8px',
    )
  })

  it('强调色写进外壳的自定义属性', () => {
    const wrapper = render({ accent: 'var(--state-warning)' })

    expect(wrapper.get('.dt-header').attributes('style')).toContain(
      '--dt-header-accent: var(--state-warning)',
    )
  })

  it('背景留空时不写背景样式', () => {
    const wrapper = render({ background: '' })

    expect(wrapper.get('.dt-header').attributes('style')).not.toContain(
      'background',
    )
  })

  it('填了背景才写背景样式', () => {
    const wrapper = render({ background: 'var(--surface-panel)' })

    expect(wrapper.get('.dt-header').attributes('style')).toContain(
      'background: var(--surface-panel)',
    )
  })
})
