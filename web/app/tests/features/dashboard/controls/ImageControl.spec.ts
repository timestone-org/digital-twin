/**
 * @fileoverview 契约：图片控件按来源分两条路画预览——CSS 值走 background、URL 走 `<img>`。
 * ⚠ 塞错了不会报错，只会得到一个碎图图标，看着像素材坏了。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'

import ImageControl from '@/features/dashboard/controls/ImageControl.vue'
import { imageSourceKind } from '@/features/dashboard/controls/imageSource'

const FIELD: ConfigField = { key: 'bg', label: '背景图', type: 'image' }

function mountImage(value: unknown) {
  return mount(ImageControl, { props: { field: FIELD, value } })
}

/** 最后一次抛出的 `update`。 */
function lastUpdate(wrapper: ReturnType<typeof mountImage>): unknown[] {
  const events = wrapper.emitted('update') ?? []
  return events.at(-1) ?? []
}

describe('来源判别', () => {
  it('CSS background 简写认成 css', () => {
    expect(imageSourceKind('var(--fx-decor-topbg)')).toBe('css')
    expect(imageSourceKind('linear-gradient(#000, #fff)')).toBe('css')
    expect(imageSourceKind('url(/a.png) no-repeat')).toBe('css')
  })

  it('其余非空文本认成 url', () => {
    expect(imageSourceKind('https://example.com/a.png')).toBe('url')
    expect(imageSourceKind('/static/a.png')).toBe('url')
  })

  it('空白与空串认成没填', () => {
    expect(imageSourceKind('')).toBe('empty')
    expect(imageSourceKind('   ')).toBe('empty')
  })
})

describe('显示现值', () => {
  it('输入框里是配置里存的原值', () => {
    const wrapper = mountImage('https://example.com/a.png')
    const el = wrapper.find('.dt-input__el').element

    expect(el instanceof HTMLInputElement ? el.value : '').toBe(
      'https://example.com/a.png',
    )
  })

  it('URL 走 img 预览', () => {
    const wrapper = mountImage('https://example.com/a.png')

    expect(wrapper.find('img').attributes('src')).toBe(
      'https://example.com/a.png',
    )
  })

  it('CSS 值走 background 预览，绝不塞进 img', () => {
    const wrapper = mountImage('linear-gradient(#000, #fff)')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.html()).toContain('linear-gradient')
  })

  it('没填时给一个占位图标，不留一个空 img', () => {
    const wrapper = mountImage(undefined)

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('值不是字符串时按没填画', () => {
    const wrapper = mountImage({ oops: true })

    expect(wrapper.find('img').exists()).toBe(false)
  })
})

describe('编辑上抛', () => {
  it('打字算连续输入，原样上抛', async () => {
    const wrapper = mountImage('')

    await wrapper.find('.dt-input__el').setValue('var(--fx-decor-topbg)')

    expect(lastUpdate(wrapper)).toStrictEqual(['var(--fx-decor-topbg)', true])
  })

  it('清空也照样上抛，用户改得回去', async () => {
    const wrapper = mountImage('https://example.com/a.png')

    await wrapper.find('.dt-input__el').setValue('')

    expect(lastUpdate(wrapper)).toStrictEqual(['', true])
  })
})
