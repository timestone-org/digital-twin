/**
 * @fileoverview 守页头的渲染契约：子节点走默认插槽（插槽名写错既不报错也不渲染）、
 * 壳里没有标题条（存量配置里遗留的 showTitle 也不该长回来），以及「空配置」与
 * 「清单缺省摊出来的配置」渲染逐字相同——两份缺省一旦漂，表现是同一张大屏在
 * 新建与重载之后长得不一样。
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

  // 大屏标题就是拖一个文字块进页头；壳再给一条标题条必然与它抢位置
  it('壳里没有标题条，存量配置里遗留的开关也长不回来', () => {
    const wrapper = render({ showTitle: true, title: '光伏大屏' })

    expect(wrapper.find('.dt-header__bar').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('光伏大屏')
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

  // ⚠ 只能写 background-color：花纹走的是 background-image，用 background 简写会把它抹掉
  it('填了背景只写底色，不碰花纹层', () => {
    const wrapper = render({ background: 'var(--surface-panel)' })

    expect(wrapper.get('.dt-header').attributes('style')).toContain(
      'background-color: var(--surface-panel)',
    )
  })
})

describe('页头的花纹、扫光与装饰', () => {
  it('风格写成修饰类，脏值回落默认档', () => {
    expect(render({ variant: 'podium' }).get('.dt-header').classes()).toContain(
      'dt-header--podium',
    )
    expect(render({ variant: 'wobble' }).get('.dt-header').classes()).toContain(
      'dt-header--default',
    )
  })

  it('CRT 扫描线默认开，素净风格下强制关掉', () => {
    expect(render({}).get('.dt-header').classes()).toContain('dt-scanlines')
    expect(
      render({ variant: 'plain' }).get('.dt-header').classes(),
    ).not.toContain('dt-scanlines')
  })

  it('扫光默认不开；开了才有那一层，素净风格下照样没有', () => {
    expect(render({}).find('.dt-header__scan').exists()).toBe(false)
    expect(render({ scan: true }).find('.dt-header__scan').exists()).toBe(true)
    expect(
      render({ scan: true, variant: 'plain' })
        .find('.dt-header__scan')
        .exists(),
    ).toBe(false)
  })

  it('扫光的宽度周期颜色只在开着时注入', () => {
    const off = render({ scanWidth: 50 }).get('.dt-header').attributes('style')
    const on = render({ scan: true, scanWidth: 50, scanDuration: 9 })
      .get('.dt-header')
      .attributes('style')

    expect(off).not.toContain('--dt-scan-w')
    expect(on).toContain('--dt-scan-w: 50%')
    expect(on).toContain('--dt-scan-dur: 9s')
  })

  it('装饰默认是横线，选「无」就不画那一层', () => {
    expect(render({}).find('.dt-header__deco--bars').exists()).toBe(true)
    expect(render({ deco: 'none' }).find('.dt-header__deco').exists()).toBe(
      false,
    )
  })

  it('底线内缩 0 不注入，超过上限夹到 49', () => {
    const none = render({}).get('.dt-header').attributes('style')
    const over = render({ glowLineInset: 80 })
      .get('.dt-header')
      .attributes('style')

    expect(none).not.toContain('--dt-glowline-inset')
    expect(over).toContain('--dt-glowline-inset: 49%')
  })

  // 开着不注入，让 CSS 里那条默认外发光生效；只有显式关掉才注入 none 去顶它
  it('底线外发光只在关掉时注入 none', () => {
    expect(render({}).get('.dt-header').attributes('style')).not.toContain(
      '--dt-glowline-shadow',
    )
    expect(
      render({ glowLineGlow: false }).get('.dt-header').attributes('style'),
    ).toContain('--dt-glowline-shadow: none')
  })
})

describe('页头底图层', () => {
  it('没填底图、也不是翼台时不出这一层', () => {
    expect(render({}).find('.dt-header__bg').exists()).toBe(false)
  })

  it('图片地址包成整宽贴底的横幅', () => {
    const style = render({ bgImage: '/a.png' })
      .get('.dt-header')
      .attributes('style')

    expect(style).toContain('center bottom / 100% 100% no-repeat')
  })

  it('CSS 简写原样透传，不再包一层 url()', () => {
    const style = render({ bgImage: 'var(--fx-decor-topbg) center bottom' })
      .get('.dt-header')
      .attributes('style')

    expect(style).toContain('--dt-header-bg: var(--fx-decor-topbg)')
    expect(style).not.toContain('url(')
  })

  // 用户给了底图就说明他要那张图的形状，再拿 clip-path 裁一刀就把图裁坏了
  it('翼台轮廓只在没自带底图时上身', () => {
    expect(
      render({ variant: 'podium' }).get('.dt-header__bg').classes(),
    ).toContain('dt-header__bg--podium')
    expect(
      render({ variant: 'podium', bgImage: '/a.png' })
        .get('.dt-header__bg')
        .classes(),
    ).not.toContain('dt-header__bg--podium')
  })
})

describe('扫光的层级开关', () => {
  it('置顶开关只改修饰类，两档都在同一层元素上', () => {
    expect(
      render({ scan: true, scanAbove: true }).get('.dt-header__scan').classes(),
    ).toContain('dt-header__scan--above')
    expect(
      render({ scan: true, scanAbove: false })
        .get('.dt-header__scan')
        .classes(),
    ).not.toContain('dt-header__scan--above')
  })
})
