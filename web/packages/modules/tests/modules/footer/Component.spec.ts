/**
 * @fileoverview 守页脚的渲染契约：子节点走默认插槽（插槽名写错既不报错也不渲染）、
 * 缺 `showTitle` 时不画标题条，以及「空配置」与「清单缺省摊出来的配置」渲染逐字相同。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('背景色与背景图都留空时一个都不注入', () => {
    const style = render({}).get('.dt-footer').attributes('style') ?? ''

    expect(style).not.toContain('background')
  })

  it('填了背景才写背景样式', () => {
    const wrapper = render({ background: 'var(--surface-panel)' })

    expect(wrapper.get('.dt-footer').attributes('style')).toContain(
      'background-color: var(--surface-panel)',
    )
  })

  it('只填了背景图时不连带写死背景色', () => {
    const wrapper = render({
      backgroundImage: 'linear-gradient(var(--accent-primary), transparent)',
    })
    const style = wrapper.get('.dt-footer').attributes('style') ?? ''

    expect(style).toContain('background-image: linear-gradient')
    expect(style).not.toContain('background-color')
  })

  it('缺省不铺点阵，开了才铺', () => {
    expect(render({}).get('.dt-footer__content').classes()).not.toContain(
      'dt-footer__content--dotted',
    )
    expect(
      render({ showDotGrid: true }).get('.dt-footer__content').classes(),
    ).toContain('dt-footer__content--dotted')
  })
})

describe('页脚可配的观感', () => {
  function shellStyle(config: Record<string, unknown>): string {
    return render(config).get('.dt-footer').attributes('style') ?? ''
  }

  it('空配置注入的观感变量就是页脚现值', () => {
    const style = shellStyle({})

    expect(style).toContain('--dt-footer-divider-w: 1px')
    expect(style).toContain('--dt-footer-sweep-opacity: 60%')
    expect(style).toContain('--dt-footer-title-justify: center')
  })

  it('分隔线关掉后线宽落到 0，粗细旋钮跟着不生效', () => {
    expect(shellStyle({ showDivider: false, dividerWidth: 4 })).toContain(
      '--dt-footer-divider-w: 0px',
    )
  })

  it('分隔线开着时粗细可配', () => {
    expect(shellStyle({ dividerWidth: 3 })).toContain(
      '--dt-footer-divider-w: 3px',
    )
  })

  it('分隔线粗细是脏值时回落 1px', () => {
    expect(shellStyle({ dividerWidth: '3' })).toContain(
      '--dt-footer-divider-w: 1px',
    )
  })

  it('扫光缺省开着，关掉后整条伪元素退场', () => {
    expect(render({}).get('.dt-footer').classes()).not.toContain(
      'dt-footer--sweepless',
    )
    expect(render({ showSweep: false }).get('.dt-footer').classes()).toContain(
      'dt-footer--sweepless',
    )
  })

  it('扫光浓度按百分比注入，浮点尾数不外泄', () => {
    expect(shellStyle({ sweepOpacity: 0.35 })).toContain(
      '--dt-footer-sweep-opacity: 35%',
    )
    expect(shellStyle({ sweepOpacity: 0 })).toContain(
      '--dt-footer-sweep-opacity: 0%',
    )
  })

  it('标题对齐三档各自落到 flex 主轴对齐值上', () => {
    expect(shellStyle({ titleAlign: 'left' })).toContain(
      '--dt-footer-title-justify: flex-start',
    )
    expect(shellStyle({ titleAlign: 'right' })).toContain(
      '--dt-footer-title-justify: flex-end',
    )
  })

  it('标题对齐是名单外的值时回落居中', () => {
    expect(shellStyle({ titleAlign: 'justify' })).toContain(
      '--dt-footer-title-justify: center',
    )
  })
})

// ⚠ vitest 不编译 scoped 样式块，字体变量接错只能对着源码钉：
//   读了没人发射的变量名，配了 fontFamily 也永远走兜底字体，全程无报错
describe('标题字体变量（源码契约）', () => {
  const SOURCE = readFileSync(
    join(
      process.cwd(),
      'packages',
      'modules',
      'src',
      'modules',
      'footer',
      'Component.vue',
    ),
    'utf8',
  )

  it('标题读 cardVars 发射的 --card-font，留空兜底 --font-display', () => {
    expect(SOURCE).toContain('var(--card-font, var(--font-display))')
  })

  it('没人发射的 --card-title-font 不许出现', () => {
    expect(SOURCE).not.toContain('--card-title-font')
  })
})
