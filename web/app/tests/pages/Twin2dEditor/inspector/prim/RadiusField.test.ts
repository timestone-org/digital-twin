/**
 * @fileoverview 契约：圆角三形（一个数 / 药丸 / 四角分别给）互换时把当下这个数带过去，
 * 四角的次序是 tl / tr / br / bl。
 *
 * ⚠ 药丸是跟着高度走的那一档，拿一个大数顶替它，盒一变高就露出直边。
 * ⚠ 四角调换两项在方形上看不出来，一到长条盒就整个歪掉。
 */
import type { Twin2dRadius } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RadiusField from '@/pages/Twin2dEditor/components/inspector/prim/RadiusField.vue'

function mountField(modelValue: Twin2dRadius) {
  return mount(RadiusField, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dRadius {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回圆角')
  return events[events.length - 1]?.[0] as Twin2dRadius
}

/** 形状那一格的下拉。 */
function form(wrapper: Wrapper) {
  return wrapper.getComponent(DtSelect)
}

describe('认形', () => {
  it('数是一个数那一形', () => {
    expect(form(mountField(6)).props('modelValue')).toBe('one')
  })

  it('四元组是四角那一形', () => {
    expect(form(mountField([1, 2, 3, 4])).props('modelValue')).toBe('corners')
  })

  it('药丸自成一形', () => {
    expect(form(mountField('pill')).props('modelValue')).toBe('pill')
  })
})

describe('换形', () => {
  it('一个数换四角时四角同值', () => {
    const wrapper = mountField(6)

    form(wrapper).vm.$emit('update:modelValue', 'corners')

    expect(lastWrite(wrapper)).toEqual([6, 6, 6, 6])
  })

  // ⚠ 换一下就清零的话，微调圆角要从头再填一遍四个格子
  it('四角换一个数时取左上角', () => {
    const wrapper = mountField([8, 2, 2, 2])

    form(wrapper).vm.$emit('update:modelValue', 'one')

    expect(lastWrite(wrapper)).toBe(8)
  })

  // ⚠ 药丸那一形没有数可带，落到 0 而不是留着上一形的数
  it('药丸换一个数时从 0 起步', () => {
    const wrapper = mountField('pill')

    form(wrapper).vm.$emit('update:modelValue', 'one')

    expect(lastWrite(wrapper)).toBe(0)
  })

  it('药丸换四角时四角都从 0 起步', () => {
    const wrapper = mountField('pill')

    form(wrapper).vm.$emit('update:modelValue', 'corners')

    expect(lastWrite(wrapper)).toEqual([0, 0, 0, 0])
  })

  it('换药丸写回药丸', () => {
    const wrapper = mountField(6)

    form(wrapper).vm.$emit('update:modelValue', 'pill')

    expect(lastWrite(wrapper)).toBe('pill')
  })

  it('换成本来那一形什么都不写', () => {
    const wrapper = mountField(6)

    form(wrapper).vm.$emit('update:modelValue', 'one')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('认不出的形什么都不写', () => {
    const wrapper = mountField(6)

    form(wrapper).vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('改值', () => {
  it('一个数那一形直接写回', async () => {
    const wrapper = mountField(6)

    await wrapper.find('[data-test="radius-one"]').setValue('10')

    expect(lastWrite(wrapper)).toBe(10)
  })

  // ⚠ 次序与 CSS 的 border-radius 逐字相同
  it('四角各写各的，次序是 tl / tr / br / bl', async () => {
    const wrapper = mountField([0, 0, 0, 0])

    await wrapper.find('[data-test="radius-corner-2"]').setValue('5')

    expect(lastWrite(wrapper)).toEqual([0, 0, 5, 0])
  })

  it('四角逐角各写各的', async () => {
    const wrapper = mountField([1, 2, 3, 4])

    await wrapper.find('[data-test="radius-corner-0"]').setValue('9')
    expect(lastWrite(wrapper)).toEqual([9, 2, 3, 4])

    await wrapper.find('[data-test="radius-corner-1"]').setValue('9')
    expect(lastWrite(wrapper)).toEqual([1, 9, 3, 4])

    await wrapper.find('[data-test="radius-corner-3"]').setValue('9')
    expect(lastWrite(wrapper)).toEqual([1, 2, 3, 9])
  })

  it('药丸那一形不摆数字格', () => {
    const wrapper = mountField('pill')

    expect(wrapper.find('[data-test="radius-one"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="radius-corner-0"]').exists()).toBe(false)
  })

  it('失焦转出一次 blur', async () => {
    const wrapper = mountField(6)

    await wrapper.find('div').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
