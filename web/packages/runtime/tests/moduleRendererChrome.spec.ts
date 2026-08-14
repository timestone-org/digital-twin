/**
 * @fileoverview 守卡片外观真的接到了渲染根上：大屏级缺省与模块级覆盖合并后注入，
 * 且**没配任何键时一个变量都不注入**——那正是「未设置 = 走平台默认」的落点。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModuleRenderer from '../src/ModuleRenderer.vue'
import { fakeCatalog, fakeManifest } from '../src/testing/fixtures'

const catalog = fakeCatalog([
  fakeManifest({ type: 'card-module' }),
  fakeManifest({ type: 'bare-module', chrome: 'bare' }),
])

function mountCell(
  moduleType: string,
  cardChrome?: Record<string, unknown>,
  config: Record<string, unknown> = {},
) {
  return mount(ModuleRenderer, {
    props: { moduleType, config, getManifest: catalog, cardChrome },
  })
}

describe('卡片外观的注入', () => {
  it('没配任何键时不带 style 属性', () => {
    const wrapper = mountCell('card-module')

    expect(wrapper.attributes('style')).toBeUndefined()
    expect(wrapper.classes()).toEqual(['dt-module', 'dt-module--card'])
  })

  it('大屏级缺省注入到渲染根上', () => {
    const wrapper = mountCell('card-module', { radius: 4 })

    expect(wrapper.attributes('style')).toContain('--card-radius: 4px')
  })

  it('模块级同键盖过大屏级，异键各自生效', () => {
    const wrapper = mountCell(
      'card-module',
      { radius: 4, titleGap: 6 },
      { __cardStyle: { radius: 12 } },
    )

    const style = wrapper.attributes('style') ?? ''
    expect(style).toContain('--card-radius: 12px')
    expect(style).toContain('--card-title-gap: 6px')
  })

  it('模块级把某项改回默认时删键即可，不留大屏级的残留', () => {
    const wrapper = mountCell(
      'card-module',
      { corners: false },
      { __cardStyle: { corners: true } },
    )

    expect(wrapper.attributes('style')).toBeUndefined()
  })

  it('无边框档去掉卡片框，内容全幅', () => {
    const wrapper = mountCell('card-module', { borderStyle: 'none' })

    expect(wrapper.classes()).not.toContain('dt-module--card')
  })

  it('边框样式与悬停辉光贴成修饰类', () => {
    const wrapper = mountCell('card-module', {
      borderStyle: 'dashed',
      hoverGlow: true,
    })

    expect(wrapper.classes()).toContain('dt-card-border--dashed')
    expect(wrapper.classes()).toContain('dt-module--hover-glow')
  })

  it('裸渲染模块不套框也不贴修饰类，但变量照常给模块自己用', () => {
    const wrapper = mountCell('bare-module', {
      borderStyle: 'dashed',
      titleColor: 'var(--text-title)',
    })

    expect(wrapper.classes()).toEqual(['dt-module'])
    expect(wrapper.attributes('style')).toContain('--card-title-color')
  })

  it('config 里的脏 __cardStyle 不影响渲染', () => {
    const wrapper = mountCell('card-module', undefined, { __cardStyle: 7 })

    expect(wrapper.attributes('style')).toBeUndefined()
    expect(wrapper.classes()).toContain('dt-module--card')
  })
})
