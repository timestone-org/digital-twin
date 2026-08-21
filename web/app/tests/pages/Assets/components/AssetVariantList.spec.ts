/**
 * @fileoverview 契约：压缩档一览要如实说出「压缩中 / 失败」，并给出失败原因。
 *
 * ⚠ 藏起来是最糟的选项：压缩失败不影响素材可用（原件一直在桶里），用户看到的
 * 会是「选了一档却还是那么慢」，而没有任何一处说得清为什么。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { AssetVariant } from '@/api/assets'
import AssetVariantList from '@/pages/Assets/components/AssetVariantList.vue'

const MB = 1024 * 1024

function variant(over: Partial<AssetVariant> = {}): AssetVariant {
  return {
    variant: 'high',
    label: '高画质',
    hint: '不减面，只做无损几何压缩',
    status: 'ready',
    sizeBytes: 20 * MB,
    checksum: 'x',
    error: '',
    ...over,
  }
}

function render(variants: AssetVariant[], canManage = true) {
  return mount(AssetVariantList, {
    props: {
      variants,
      originalBytes: 100 * MB,
      canManage,
      isBusy: false,
    },
  })
}

describe('压缩档一览', () => {
  it('压好的那档给出体积与相对原件的比例', () => {
    const wrapper = render([variant()])

    expect(wrapper.text()).toContain('20 MB')
    // 用户问的是「比原来小多少」，故分母是原件而不是最大的那一档
    expect(wrapper.text()).toContain('20%')
  })

  it('还在压的那档说「压缩中」，且不给一个假的体积', () => {
    const wrapper = render([variant({ status: 'pending', sizeBytes: null })])

    expect(wrapper.text()).toContain('压缩中')
    // 0 会显示成「0 B」，那是一个看着像已经压完的假事实
    expect(wrapper.text()).not.toContain('0 B')
  })

  it('失败的那档必须把原因摆出来', () => {
    const wrapper = render([
      variant({ status: 'failed', sizeBytes: null, error: '压缩超时' }),
    ])

    // 不给原因的话，用户只知道「有一档没成」，而重压一遍大概率还是同样的结果
    expect(wrapper.text()).toContain('压缩超时')
  })

  it('压缩期间要说清素材照常可用', () => {
    const wrapper = render([variant({ status: 'pending', sizeBytes: null })])

    expect(wrapper.text()).toContain('原件')
  })

  it('只读账号没有重压入口', () => {
    const wrapper = render([variant({ status: 'failed' })], false)

    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('持权限时点重压会抛事件', async () => {
    const wrapper = render([variant({ status: 'failed' })])

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('recompress')).toHaveLength(1)
  })

  it('原件体积不明时不画出一个荒唐的比例', () => {
    const wrapper = mount(AssetVariantList, {
      props: {
        variants: [variant()],
        originalBytes: 0,
        canManage: true,
        isBusy: false,
      },
    })

    // 除以 0 会得到 Infinity%，那比不显示更糟
    expect(wrapper.text()).not.toContain('Infinity')
  })
})
