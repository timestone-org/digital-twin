/**
 * @fileoverview 契约：图片控件按来源分三条路画预览——CSS 值走 background、URL 走 `<img>`、
 * 素材引用先摊成地址再走 `<img>`；以及从素材库挑中时落库的是 `asset:` 引用而不是 URL。
 * ⚠ 塞错了不会报错，只会得到一个碎图图标，看着像素材坏了。
 * ⚠ 落 URL 更隐蔽：换一次部署那条链接就 404，而存量配置里没有任何一处会报错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'

import ImageControl from '@/features/dashboard/controls/ImageControl.vue'
import AssetPickerDialog from '@/components/assets/AssetPickerDialog.vue'
import {
  __resetAssetImages,
  configureAssetImages,
  imageSourceKind,
} from '@dt/modules'

const api = vi.hoisted(() => ({
  getAsset: vi.fn(),
  listAssets: vi.fn(),
  listAssetKinds: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

vi.mock('@/api/assets', () => api)

const ID = '0192f0aa-0000-7000-8000-000000000001'
const REF = `asset:${ID}`
const ASSET_URL = `/oss/images/${ID}`

// 问名字是控件挂载就发的一次请求，每条用例都得给它一个能 then 的返回
beforeEach(() => {
  api.getAsset.mockResolvedValue({ id: ID, name: '素材' })
})

afterEach(() => {
  __resetAssetImages()
  vi.clearAllMocks()
})

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

describe('素材引用', () => {
  it('摊得出地址就走 img，绝不把 asset: 原样塞进去', () => {
    configureAssetImages(() => ASSET_URL)

    expect(mountImage(REF).find('img').attributes('src')).toBe(ASSET_URL)
  })

  // 摊不出地址（宿主没装解析、素材已被删）时预览留占位图标，而不是一个碎图
  it('摊不出地址时不渲染空 img', () => {
    expect(mountImage(REF).find('img').exists()).toBe(false)
  })

  it('挑过素材就不摆输入框：那一格里是引用，摆出来只会诱人手改成 URL', () => {
    expect(mountImage(REF).find('.dt-input__el').exists()).toBe(false)
    expect(
      mountImage('https://example.com/a.png').find('.dt-input__el').exists(),
    ).toBe(true)
  })

  it('问得到名字就显示名字，问不到退回引用串本身', async () => {
    api.getAsset.mockResolvedValueOnce({ id: ID, name: '厂区俯视图.png' })
    const named = mountImage(REF)
    await flushPromises()

    expect(named.text()).toContain('厂区俯视图.png')

    api.getAsset.mockRejectedValueOnce(new Error('网络错误'))
    const bare = mountImage(REF)
    await flushPromises()

    expect(bare.text()).toContain(REF)
  })

  it('不是引用就不去问名字，省掉一次没人要的请求', () => {
    mountImage('https://example.com/a.png')

    expect(api.getAsset).not.toHaveBeenCalled()
  })
})

describe('从素材库挑图', () => {
  it('挑中落库的是 asset: 引用，不是 URL', async () => {
    const wrapper = mountImage('')

    wrapper
      .getComponent(AssetPickerDialog)
      .vm.$emit('pick', REF, { name: '厂区俯视图.png' })
    await flushPromises()

    expect(lastUpdate(wrapper)).toStrictEqual([REF, true])
  })

  it('挑选器只挑图片：挑到模型是配错而不是自由', () => {
    expect(mountImage('').getComponent(AssetPickerDialog).props('kind')).toBe(
      'image',
    )
  })

  it('清除把值写回空串，用户改得回去', async () => {
    const wrapper = mountImage(REF)

    await wrapper.get('button[aria-label="清除素材"]').trigger('click')

    expect(lastUpdate(wrapper)).toStrictEqual(['', true])
  })
})
