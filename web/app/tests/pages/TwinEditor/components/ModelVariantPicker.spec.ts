/**
 * @fileoverview 契约：没压好的档必须禁选。
 *
 * ⚠ 选中一个没压好的档，现场就是一块永远转圈的黑屏——所以拦在「选」这一步，
 * 而不是等到渲染时才发现。原件永远可选：它是压缩失败时唯一的退路。
 * ⚠ 断言的是**交给 `DtSelect` 的选项表**而不是它画出来的 DOM：那个下拉的菜单
 * teleport 到 body 且只在展开后渲染，跟着它的内部结构走会让这份用例在 DtSelect
 * 改皮肤的那天无故变红——而这里要守的本来就是「哪几档可选」。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DtSelectOption } from '@dt/contracts'

import type { Asset, AssetVariant } from '@/api/assets'
import ModelVariantPicker from '@/pages/TwinEditor/components/inspector/ModelVariantPicker.vue'

const api = vi.hoisted(() => ({ getAsset: vi.fn() }))
vi.mock('@/api/assets', () => api)

const ID = '0192f0aa-0000-7000-8000-000000000001'
const REF = `asset:${ID}`
const MB = 1024 * 1024

/** 只记下拿到的选项表，不画任何东西。 */
const SelectStub = {
  name: 'DtSelect',
  props: ['modelValue', 'options', 'label', 'hint', 'size'],
  template: '<div data-test="select" />',
}

function variant(over: Partial<AssetVariant>): AssetVariant {
  return {
    variant: 'high',
    label: '高画质',
    hint: '',
    status: 'ready',
    sizeBytes: 20 * MB,
    checksum: 'x',
    error: '',
    ...over,
  }
}

function asset(variants: AssetVariant[]): Asset {
  return {
    id: ID,
    ref: REF,
    kind: 'model',
    name: '主厂房.glb',
    contentType: 'model/gltf-binary',
    sizeBytes: 100 * MB,
    checksum: 'y',
    createdAt: '2026-08-20T00:00:00.000Z',
    createdBy: 'me',
    variants,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

async function render(variants: AssetVariant[], picked = 'original') {
  api.getAsset.mockResolvedValue(asset(variants))
  const wrapper = mount(ModelVariantPicker, {
    props: { assetRef: REF, modelValue: picked as never },
    global: { stubs: { DtSelect: SelectStub } },
  })
  await flushPromises()
  return wrapper
}

/** 交给下拉的那张选项表。 */
function optionsOf(wrapper: ReturnType<typeof mount>): DtSelectOption[] {
  const select = wrapper.findComponent(SelectStub)
  return select.props('options') as DtSelectOption[]
}

/** 按档名取那一项；没有即测试写错了。 */
function optionFor(
  wrapper: ReturnType<typeof mount>,
  value: string,
): DtSelectOption {
  const found = optionsOf(wrapper).find((one) => one.value === value)
  if (found === undefined) throw new Error(`选项表里没有 ${value}`)
  return found
}

describe('档位选择器', () => {
  it('压好的档可选，没压好的禁选', async () => {
    const wrapper = await render([
      variant({ variant: 'high', status: 'ready' }),
      variant({ variant: 'medium', status: 'pending', sizeBytes: null }),
      variant({ variant: 'low', status: 'failed', sizeBytes: null }),
    ])

    expect(optionFor(wrapper, 'high').disabled).toBe(false)
    expect(optionFor(wrapper, 'medium').disabled).toBe(true)
    expect(optionFor(wrapper, 'low').disabled).toBe(true)
  })

  it('原件永远可选——它是压缩失败时唯一的退路', async () => {
    const wrapper = await render([
      variant({ variant: 'high', status: 'failed', sizeBytes: null }),
      variant({ variant: 'medium', status: 'failed', sizeBytes: null }),
      variant({ variant: 'low', status: 'failed', sizeBytes: null }),
    ])

    expect(optionFor(wrapper, 'original').disabled).toBe(false)
  })

  it('一档都还没有登记时，三档全禁选而原件照旧', async () => {
    const wrapper = await render([])

    // 存量素材是建表之前传的，一行档都没有——那时不能让人选到一个不存在的档
    expect(optionFor(wrapper, 'high').disabled).toBe(true)
    expect(optionFor(wrapper, 'original').disabled).toBe(false)
  })

  it('逐档标出体积——选档的人问的正是「小多少」', async () => {
    const wrapper = await render([variant({ variant: 'high' })])

    expect(optionFor(wrapper, 'high').label).toContain('20 MB')
    expect(optionFor(wrapper, 'original').label).toContain('100 MB')
  })

  it('没压好的档在文案上就说明白，不让人点了才知道', async () => {
    const wrapper = await render([
      variant({ variant: 'medium', status: 'pending', sizeBytes: null }),
    ])

    expect(optionFor(wrapper, 'medium').label).toContain('压缩中')
  })

  it('已选的档后来失败了要当面说清会走原件', async () => {
    const wrapper = await render(
      [
        variant({
          variant: 'high',
          status: 'failed',
          sizeBytes: null,
          error: '压缩超时',
        }),
      ],
      'high',
    )

    // 存量配置可能指着一个后来失败了的档，不说的话现场只会「莫名其妙变慢」
    expect(wrapper.text()).toContain('走原件')
    expect(wrapper.text()).toContain('压缩超时')
  })

  it('还没挑模型时整块不出现，也不去取数', () => {
    const wrapper = mount(ModelVariantPicker, {
      props: { assetRef: '', modelValue: 'original' },
      global: { stubs: { DtSelect: SelectStub } },
    })

    expect(wrapper.text()).toBe('')
    expect(api.getAsset).not.toHaveBeenCalled()
  })
})
