/**
 * @fileoverview 守图片块的渲染契约：URL 与 CSS 值走各自的画法、取不回图时画占位而不是
 * 碎图、滤镜里的负值先夹掉（一项非法会让整条 filter 声明作废，表现是其他几档一起失效）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/image-block/Component.vue'

const URL_SRC = 'https://example.com/plant.png'

function render(config: Record<string, unknown> = {}) {
  return mount(Component, { props: { config, values: {} } })
}

function imageStyle(config: Record<string, unknown>): string {
  return render(config).get('img').attributes('style') ?? ''
}

describe('图片块的来源', () => {
  it('没填时画占位，不渲染必然加载失败的图', () => {
    const wrapper = render({})

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.dt-image-block__empty').text()).toBe('未设置图片')
  })

  it('一串空白算没填', () => {
    expect(render({ src: '   ' }).find('img').exists()).toBe(false)
  })

  it('地址前后的空白被去掉后才进 src', () => {
    const wrapper = render({ src: `  ${URL_SRC}  ` })

    expect(wrapper.get('img').attributes('src')).toBe(URL_SRC)
  })

  it('CSS 值走背景层，不塞进 img', () => {
    const wrapper = render({ src: 'linear-gradient(#000, #fff)' })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.dt-image-block__css').attributes('style')).toContain(
      'background-image: linear-gradient(#000, #fff)',
    )
  })

  it('替代文字落到 img 上', () => {
    const wrapper = render({ src: URL_SRC, alt: '厂区俯视图' })

    expect(wrapper.get('img').attributes('alt')).toBe('厂区俯视图')
  })
})

describe('图片块的取数失败', () => {
  it('取不回图时换成占位，而不是留一个碎图图标', async () => {
    const wrapper = render({ src: URL_SRC })
    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.dt-image-block__empty').text()).toBe('图片加载失败')
  })

  it('换了地址就重新试一次，不把上一张的失败带过来', async () => {
    const wrapper = render({ src: URL_SRC })
    await wrapper.get('img').trigger('error')
    await wrapper.setProps({ config: { src: 'https://example.com/other.png' } })

    expect(wrapper.get('img').attributes('src')).toBe(
      'https://example.com/other.png',
    )
  })
})

describe('图片块的画面调节', () => {
  it('缺省是完整显示、居中、不透明，且不注入圆角与滤镜', () => {
    const style = imageStyle({ src: URL_SRC })

    expect(style).toContain('object-fit: contain')
    expect(style).toContain('object-position: center')
    expect(style).toContain('opacity: 1')
    expect(style).not.toContain('border-radius')
    expect(style).not.toContain('filter')
    expect(style).not.toContain('transform')
  })

  it('清单里没有的填充方式回落完整显示，不让浏览器退成拉伸', () => {
    expect(imageStyle({ src: URL_SRC, fit: 'squeeze' })).toContain(
      'object-fit: contain',
    )
  })

  it('填充方式在 CSS 值那条路上换算成 background-size', () => {
    const wrapper = render({ src: 'url(/logo.png)', fit: 'fill' })

    expect(wrapper.get('.dt-image-block__css').attributes('style')).toContain(
      'background-size: 100% 100%',
    )
  })

  it('裁剪定位两条路都认', () => {
    expect(
      imageStyle({ src: URL_SRC, fit: 'cover', position: 'top' }),
    ).toContain('object-position: top')
    expect(
      render({ src: 'url(/logo.png)', position: 'top' })
        .get('.dt-image-block__css')
        .attributes('style'),
    ).toContain('background-position: center top')
  })

  it('不透明度按百分比换算，越界先夹回 0..100', () => {
    expect(imageStyle({ src: URL_SRC, opacity: 40 })).toContain('opacity: 0.4')
    expect(imageStyle({ src: URL_SRC, opacity: 999 })).toContain('opacity: 1')
    expect(imageStyle({ src: URL_SRC, opacity: -20 })).toContain('opacity: 0')
  })

  it('圆角为 0 时不注入', () => {
    expect(imageStyle({ src: URL_SRC, rounded: 12 })).toContain(
      'border-radius: 12px',
    )
    expect(imageStyle({ src: URL_SRC, rounded: 0 })).not.toContain(
      'border-radius',
    )
  })

  it('翻转与旋转拼成一条 transform', () => {
    const style = imageStyle({
      src: URL_SRC,
      flipX: true,
      flipY: true,
      rotate: 90,
    })

    expect(style).toContain('transform: scaleX(-1) scaleY(-1) rotate(90deg)')
  })
})

describe('图片块的滤镜', () => {
  it('几档滤镜按顺序拼成一条声明', () => {
    const style = imageStyle({
      src: URL_SRC,
      blur: 2,
      grayscale: 50,
      brightness: 120,
      contrast: 90,
      saturate: 150,
    })

    expect(style).toContain(
      'filter: blur(2px) grayscale(50%) brightness(120%) contrast(90%) saturate(150%)',
    )
  })

  it('等于缺省的百分比档不写进去，不给浏览器一条恒等的滤镜', () => {
    expect(
      imageStyle({ src: URL_SRC, brightness: 100, contrast: 100 }),
    ).not.toContain('filter')
  })

  it('负值先夹到 0，免得整条 filter 声明作废、其他几档一起失效', () => {
    const style = imageStyle({ src: URL_SRC, brightness: -50, blur: -3 })

    expect(style).toContain('filter: brightness(0%)')
    expect(style).not.toContain('blur')
  })
})

describe('图片块的标题栏', () => {
  it('没填标题就不画标题栏', () => {
    expect(render({ src: URL_SRC }).find('.module-title-bar').exists()).toBe(
      false,
    )
  })

  it('填了标题才画，文字原样上屏', () => {
    const wrapper = render({ src: URL_SRC, title: '厂区 Logo' })

    expect(wrapper.get('.module-title-bar__text').text()).toBe('厂区 Logo')
  })
})
