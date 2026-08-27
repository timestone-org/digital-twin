/**
 * @fileoverview 契约：图标五来源都配得出来；内置图标集里那四枚插画式多色图标上颜色
 * 那一格禁用并写明原因，未登记的注册名与空素材引用当场标红。
 *
 * ⚠ 颜色格留着可点的话，用户点了没反应——既不报错也不像 bug。
 * ⚠ 未登记的图标名什么都不渲染，零报错；空素材引用会让整档落回「不画图标」。
 */
import {
  TWIN_2D_FIXED_COLOR_SPRITES,
  TWIN_2D_ICO_SRC_KINDS,
  TWIN_2D_SPRITE_IDS,
  normalizePrims,
} from '@dt/twin2d'
import type { Twin2dIcoPrim, Twin2dPrim } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect, isIconName } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import IcoFields from '@/pages/Twin2dEditor/components/inspector/prim/IcoFields.vue'

function icoPrim(over: Readonly<Record<string, unknown>> = {}): Twin2dIcoPrim {
  const one = normalizePrims([{ id: 'p1', kind: 'ico', ...over }], 0)[0]
  if (one === undefined || one.kind !== 'ico')
    throw new Error('样例图标没造出来')
  return one
}

function mountFields(modelValue: Twin2dIcoPrim = icoPrim()) {
  return mount(IcoFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dIcoPrim {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回图标')
  const one = events[events.length - 1]?.[0] as Twin2dPrim
  if (one.kind !== 'ico') throw new Error('写回的不是图标')
  return one
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('五来源', () => {
  it('一档不少', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountFields(),
      'ico-kind',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual([...TWIN_2D_ICO_SRC_KINDS])
  })

  it('换档给的每一档都认得出 kind', () => {
    for (const kind of TWIN_2D_ICO_SRC_KINDS.filter((one) => one !== 'none')) {
      const wrapper = mountFields()

      selectAt(wrapper, 'ico-kind').vm.$emit('update:modelValue', kind)

      expect(lastWrite(wrapper).src.kind, kind).toBe(kind)
    }
  })

  // ⚠ 注册名与素材引用是两个命名空间，带过去只会得到一个必然解析不到的引用
  it('换档不带旧值过去', () => {
    const wrapper = mountFields(
      icoPrim({ src: { kind: 'name', name: 'user' } }),
    )

    selectAt(wrapper, 'ico-kind').vm.$emit('update:modelValue', 'asset')

    expect(lastWrite(wrapper).src).toEqual({ kind: 'asset', ref: '' })
  })

  it('换成本来那一档与认不出的档位都不写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'ico-kind').vm.$emit('update:modelValue', 'none')
    selectAt(wrapper, 'ico-kind').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('注册名', () => {
  it('挑一个已登记的名字写回文档', () => {
    const wrapper = mountFields(
      icoPrim({ src: { kind: 'name', name: 'user' } }),
    )

    selectAt(wrapper, 'ico-name').vm.$emit('update:modelValue', 'lock')

    expect(lastWrite(wrapper).src).toEqual({ kind: 'name', name: 'lock' })
  })

  it('可选项全是已登记的名字', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountFields(icoPrim({ src: { kind: 'name', name: 'user' } })),
      'ico-name',
    ).props('options')

    expect(options.length).toBeGreaterThan(0)
    expect(options.every((one) => isIconName(one.value))).toBe(true)
  })

  // ⚠ 未登记的名字什么都不渲染，零报错
  it('未登记的名字当场标红并照样摆进下拉', () => {
    const wrapper = mountFields(
      icoPrim({ src: { kind: 'name', name: 'not-an-icon' } }),
    )
    const name = selectAt(wrapper, 'ico-name')
    const options: readonly DtSelectOption[] = name.props('options')

    expect(name.props('error')).toContain('一片空白')
    expect(options.some((one) => one.value === 'not-an-icon')).toBe(true)
  })
})

describe('内置图标集', () => {
  it('十一枚一枚不少', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountFields(icoPrim({ src: { kind: 'sprite', id: 'ico-tap' } })),
      'ico-sprite',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual([...TWIN_2D_SPRITE_IDS])
  })

  it('挑一枚写回文档', () => {
    const wrapper = mountFields(
      icoPrim({ src: { kind: 'sprite', id: 'ico-tap' } }),
    )

    selectAt(wrapper, 'ico-sprite').vm.$emit('update:modelValue', 'ico-hx')

    expect(lastWrite(wrapper).src).toEqual({ kind: 'sprite', id: 'ico-hx' })
  })

  it('认不出的 id 不写回', () => {
    const wrapper = mountFields(
      icoPrim({ src: { kind: 'sprite', id: 'ico-tap' } }),
    )

    selectAt(wrapper, 'ico-sprite').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('颜色', () => {
  // ⚠ 那四枚的颜色写死在图形里，可点的颜色格点了没反应
  it('多色图标上颜色格禁用并写明原因', () => {
    for (const id of TWIN_2D_FIXED_COLOR_SPRITES) {
      const wrapper = mountFields(icoPrim({ src: { kind: 'sprite', id } }))
      const locked = wrapper.find('[data-test="ico-color-locked"]')

      expect(locked.exists(), id).toBe(true)
      expect(locked.attributes('disabled'), id).toBeDefined()
      expect(wrapper.text()).toContain('颜色写死在图形里')
    }
  })

  it('单色图标上颜色格照常可改', async () => {
    const wrapper = mountFields(
      icoPrim({ src: { kind: 'sprite', id: 'ico-tap' } }),
    )

    expect(wrapper.find('[data-test="ico-color-locked"]').exists()).toBe(false)
    await wrapper.find('.dt-color__text input').setValue('url(a.png)')

    expect(lastWrite(wrapper).color).toBe('currentColor')
  })
})

describe('素材与手绘', () => {
  // ⚠ 空引用的素材档只在编辑器里活着（归一化会把它整档压回 none），所以直接搭一份
  const emptyAsset: Twin2dIcoPrim = {
    ...icoPrim(),
    src: { kind: 'asset', ref: '' },
  }

  it('空素材引用当场标红', () => {
    expect(mountFields(emptyAsset).text()).toContain('落回「不画图标」')
  })

  it('素材引用写回文档', async () => {
    const wrapper = mountFields(emptyAsset)

    await wrapper.find('[data-test="ico-asset"]').setValue('asset:abc')

    expect(lastWrite(wrapper).src).toEqual({ kind: 'asset', ref: 'asset:abc' })
  })

  it('手绘那一档摆画幅与几笔', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'ico-kind').vm.$emit('update:modelValue', 'draw')

    expect(lastWrite(wrapper).src).toMatchObject({
      kind: 'draw',
      viewBox: [48, 48],
      parts: [],
    })
  })

  it('画幅两边各写各的', async () => {
    const drawn = icoPrim({
      src: {
        kind: 'draw',
        viewBox: [48, 48],
        parts: [{ shape: { kind: 'line', x2: 1, y2: 1 } }],
      },
    })
    const wrapper = mountFields(drawn)

    await wrapper.find('[data-test="ico-vb-h"]').setValue('24')

    expect(lastWrite(wrapper).src).toMatchObject({ viewBox: [48, 24] })
  })

  it('加一笔写回手绘那一档', async () => {
    const drawn = icoPrim({
      src: {
        kind: 'draw',
        viewBox: [48, 48],
        parts: [{ shape: { kind: 'line', x2: 1, y2: 1 } }],
      },
    })
    const wrapper = mountFields(drawn)

    await wrapper.find('[data-test="draw-add"]').trigger('click')
    const src = lastWrite(wrapper).src

    expect(src.kind === 'draw' && src.parts.length).toBe(2)
  })
})

describe('基类', () => {
  it('基类那一段的改动连着图标自己的字段一起交出去', async () => {
    const wrapper = mountFields(icoPrim({ color: 'red' }))

    await wrapper.find('[data-test="base-z"]').setValue('4')

    const next = lastWrite(wrapper)
    expect(next.z).toBe(4)
    expect(next.color).toBe('red')
  })
})
