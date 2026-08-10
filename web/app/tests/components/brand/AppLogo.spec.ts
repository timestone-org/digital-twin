/**
 * @fileoverview AppLogo 的渲染契约：尺寸参数落到 width/height、非法尺寸回退、
 * 装饰性 SVG 对读屏隐藏（可读名称由承载它的链接给）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import AppLogo from '@/components/brand/AppLogo.vue'

describe('AppLogo', () => {
  it('不给尺寸时用默认值', () => {
    const svg = mount(AppLogo).find('svg')
    expect(svg.attributes('width')).toBe('28')
    expect(svg.attributes('height')).toBe('28')
  })

  it('尺寸落到 width / height 上', () => {
    const svg = mount(AppLogo, { props: { size: 44 } }).find('svg')
    expect(svg.attributes('width')).toBe('44')
    expect(svg.attributes('height')).toBe('44')
  })

  it.each([
    ['NaN', Number.NaN],
    ['零', 0],
    ['负数', -8],
  ])('非法尺寸（%s）回退默认值而不是产出非法属性', (_name, size) => {
    const svg = mount(AppLogo, { props: { size } }).find('svg')
    expect(svg.attributes('width')).toBe('28')
  })

  it('viewBox 固定 1024，缩放只由 width/height 决定', () => {
    expect(mount(AppLogo).find('svg').attributes('viewBox')).toBe(
      '0 0 1024 1024',
    )
  })

  it('对读屏隐藏：它是装饰，名称由承载它的链接或按钮给', () => {
    const svg = mount(AppLogo).find('svg')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('focusable')).toBe('false')
  })

  it('轨道与立方体都画出来了，不是一个空 svg', () => {
    const wrapper = mount(AppLogo)
    expect(wrapper.findAll('path').length).toBeGreaterThan(8)
    expect(wrapper.findAll('circle').length).toBeGreaterThan(4)
  })
})
