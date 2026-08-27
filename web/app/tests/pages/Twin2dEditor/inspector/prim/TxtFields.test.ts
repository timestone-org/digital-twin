/**
 * @fileoverview 契约：文本五来源、字体五格、行高、对齐、溢出三项与描边字都改得到；
 * 字体清一格写的是删键，省略号少了不换行时给一句说明。
 *
 * ⚠ 字体缺席即跟随主题，写一个显式的空值进去会盖掉主题值。
 * ⚠ 只勾省略号时文本会先换行、根本溢不出去，看着像「省略号没生效」。
 */
import { TWIN_2D_TXT_SRC_KINDS, normalizePrims } from '@dt/twin2d'
import type { Twin2dPrim, Twin2dTxtPrim } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TxtFields from '@/pages/Twin2dEditor/components/inspector/prim/TxtFields.vue'

function txtPrim(over: Readonly<Record<string, unknown>> = {}): Twin2dTxtPrim {
  const one = normalizePrims([{ id: 'p1', kind: 'txt', ...over }], 0)[0]
  if (one === undefined || one.kind !== 'txt')
    throw new Error('样例文本没造出来')
  return one
}

function mountFields(modelValue: Twin2dTxtPrim = txtPrim()) {
  return mount(TxtFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dTxtPrim {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回文本')
  const one = events[events.length - 1]?.[0] as Twin2dPrim
  if (one.kind !== 'txt') throw new Error('写回的不是文本')
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

describe('来源', () => {
  it('五档一档不少', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountFields(),
      'txt-kind',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual([...TWIN_2D_TXT_SRC_KINDS])
  })

  it('换档给的每一档都认得出 kind', () => {
    for (const kind of TWIN_2D_TXT_SRC_KINDS.filter((one) => one !== 'lit')) {
      const wrapper = mountFields()

      selectAt(wrapper, 'txt-kind').vm.$emit('update:modelValue', kind)

      expect(lastWrite(wrapper).src.kind, kind).toBe(kind)
    }
  })

  it('换成本来那一档与认不出的档位都不写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'txt-kind').vm.$emit('update:modelValue', 'lit')
    selectAt(wrapper, 'txt-kind').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  // ⚠ 首尾空格是排版的一部分
  it('写死的文字原样收，首尾空格不去掉', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="txt-literal"]').setValue(' 热 ')

    expect(lastWrite(wrapper).src).toEqual({ kind: 'lit', text: ' 热 ' })
  })

  it('空槽键当场标红', () => {
    const wrapper = mountFields({
      ...txtPrim(),
      src: { kind: 'slot', slot: '' },
    })

    expect(wrapper.text()).toContain('取不到槽键')
  })

  it('槽键写回文档', async () => {
    const wrapper = mountFields(
      txtPrim({ src: { kind: 'slot', slot: 'heat' } }),
    )

    await wrapper.find('[data-test="txt-slot"]').setValue('power')

    expect(lastWrite(wrapper).src).toEqual({ kind: 'slot', slot: 'power' })
  })
})

describe('字体', () => {
  it('字号与字距各写各的', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="txt-size"]').setValue('14')
    expect(lastWrite(wrapper).font.size).toBe(14)

    await wrapper.find('[data-test="txt-spacing"]').setValue('0.5')
    expect(lastWrite(wrapper).font.letterSpacing).toBe(0.5)
  })

  // ⚠ 缺席才是「跟随主题」，写一个空值进去会盖掉主题值
  it('清一格写的是删键', async () => {
    const wrapper = mountFields(txtPrim({ font: { family: '黑体' } }))

    await wrapper.find('[data-test="txt-family"]').setValue('')

    expect('family' in lastWrite(wrapper).font).toBe(false)
  })

  it('字重下拉里的跟随一档也是删键', () => {
    const wrapper = mountFields(txtPrim({ font: { weight: 600 } }))

    selectAt(wrapper, 'txt-weight').vm.$emit('update:modelValue', '')

    expect('weight' in lastWrite(wrapper).font).toBe(false)
  })

  it('字重挑一档落进文档的是数', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'txt-weight').vm.$emit('update:modelValue', '700')

    expect(lastWrite(wrapper).font.weight).toBe(700)
  })

  it('文字色写回文档', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('.dt-color__text input')
      .setValue('var(--accent-primary)')

    expect(lastWrite(wrapper).font.color).toBe('var(--accent-primary)')
  })

  // ⚠ 这一格的兜底是「留空」= 跟随上层，所以被拒的取值落成删键而不是一个硬色
  it('被消毒拒掉的颜色落回跟随上层', async () => {
    const wrapper = mountFields(txtPrim({ font: { color: 'red' } }))

    await wrapper.find('.dt-color__text input').setValue('url(a.png)')

    expect('color' in lastWrite(wrapper).font).toBe(false)
  })

  it('行高留空即跟随主题', async () => {
    const wrapper = mountFields(txtPrim({ lineHeight: 1.2 }))

    await wrapper.find('[data-test="txt-line"]').setValue('')

    expect(lastWrite(wrapper).lineHeight).toBeNull()
  })
})

describe('排版与溢出', () => {
  it('两条对齐各写各的', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'txt-align').vm.$emit('update:modelValue', 'center')
    expect(lastWrite(wrapper).align).toBe('center')

    selectAt(wrapper, 'txt-baseline').vm.$emit('update:modelValue', 'center')
    expect(lastWrite(wrapper).baseline).toBe('center')
  })

  it('认不出的对齐与基线都不写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'txt-align').vm.$emit('update:modelValue', 'nope')
    selectAt(wrapper, 'txt-baseline').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('三个开关各写各的', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="txt-nowrap"] input').setValue(true)
    expect(lastWrite(wrapper).nowrap).toBe(true)

    await wrapper.find('[data-test="txt-title"] input').setValue(true)
    expect(lastWrite(wrapper).titleAttr).toBe(true)
  })

  // ⚠ 会换行的文本溢不出去，省略号看着像没生效
  it('只勾省略号时给一句说明', () => {
    const alone = txtPrim({ ellipsis: true, nowrap: false })
    const both = txtPrim({ ellipsis: true, nowrap: true })

    expect(
      mountFields(alone).find('[data-test="txt-ellipsis-hint"]').exists(),
    ).toBe(true)
    expect(
      mountFields(both).find('[data-test="txt-ellipsis-hint"]').exists(),
    ).toBe(false)
  })
})

describe('阴影与描边字', () => {
  it('阴影表整份换', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('[data-test="txt-shadows"] [data-test="shadow-add"]')
      .trigger('click')

    expect(lastWrite(wrapper).shadows).toHaveLength(1)
  })

  it('描边字开关打开时给一档看得见的初值', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="txt-outline"] input').setValue(true)

    expect(lastWrite(wrapper).outline?.width).toBeGreaterThan(0)
  })

  it('描边字关掉写回空', async () => {
    const wrapper = mountFields(txtPrim({ outline: { width: 2 } }))

    await wrapper.find('[data-test="txt-outline"] input').setValue(false)

    expect(lastWrite(wrapper).outline).toBeNull()
  })

  it('描边宽与描边色各写各的', async () => {
    const wrapper = mountFields(txtPrim({ outline: { width: 2 } }))

    await wrapper.find('[data-test="txt-outline-width"]').setValue('3')

    expect(lastWrite(wrapper).outline?.width).toBe(3)
  })
})

describe('基类', () => {
  it('基类那一段的改动连着文本自己的字段一起交出去', async () => {
    const wrapper = mountFields(txtPrim({ nowrap: true }))

    await wrapper.find('[data-test="base-z"]').setValue('5')

    const next = lastWrite(wrapper)
    expect(next.z).toBe(5)
    expect(next.nowrap).toBe(true)
  })
})
