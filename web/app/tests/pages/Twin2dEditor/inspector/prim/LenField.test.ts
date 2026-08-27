/**
 * @fileoverview 契约：长度那一格逐键解析，解析不出就不写回文档；空框只在允许缺席的
 * 那一档才当作「这一格不给」。
 *
 * ⚠ 解析不出就写回的话，`5em` 打到 `5e` 那一下会被压成 0，于是 `em` 与小数点永远打不完。
 * ⚠ 空框在两档下是两个意思：允许缺席时是「不限」，不允许时只是「还没打完」。
 */
import type { Twin2dLen } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LenField from '@/pages/Twin2dEditor/components/inspector/prim/LenField.vue'

function mountField(modelValue: Twin2dLen | null, nullable = false) {
  return mount(LenField, { props: { modelValue, nullable, label: '宽' } })
}

type Wrapper = ReturnType<typeof mountField>

function writes(wrapper: Wrapper): readonly unknown[] {
  return (wrapper.emitted('update:modelValue') ?? []).map((one) => one[0])
}

describe('回显', () => {
  it('三种形都照原样回显', () => {
    expect(mountField(24).find('input').element.value).toBe('24')
    expect(mountField('50%').find('input').element.value).toBe('50%')
    expect(mountField('auto').find('input').element.value).toBe('auto')
  })

  it('缺席那一档是空框', () => {
    expect(mountField(null, true).find('input').element.value).toBe('')
  })
})

describe('写回', () => {
  it('裸数按设计像素收', async () => {
    const wrapper = mountField(24)

    await wrapper.find('input').setValue('36')

    expect(writes(wrapper)).toEqual([36])
  })

  it('百分比与 em 原样收', async () => {
    const wrapper = mountField(24)

    await wrapper.find('input').setValue('50%')
    await wrapper.find('input').setValue('1.5em')

    expect(writes(wrapper)).toEqual(['50%', '1.5em'])
  })

  // ⚠ 半截输入被压成 0 的话，em 与小数点永远打不完
  it('解析不出的半截输入不写回', async () => {
    const wrapper = mountField(24)

    await wrapper.find('input').setValue('5e')

    expect(writes(wrapper)).toEqual([])
  })

  it('允许缺席时空框写回缺席', async () => {
    const wrapper = mountField(24, true)

    await wrapper.find('input').setValue('')

    expect(writes(wrapper)).toEqual([null])
  })

  it('不允许缺席时空框什么都不写', async () => {
    const wrapper = mountField(24)

    await wrapper.find('input').setValue('')

    expect(writes(wrapper)).toEqual([])
  })
})

describe('焦点', () => {
  it('焦点在里面时外面的值盖不掉正敲着的那半截', async () => {
    const wrapper = mountField(24)

    await wrapper.find('.dt-t2-len').trigger('focusin')
    await wrapper.find('input').setValue('5e')
    await wrapper.setProps({ modelValue: 99 })

    expect(wrapper.find('input').element.value).toBe('5e')
  })

  it('失焦把框拨回文档里的值并转出一次 blur', async () => {
    const wrapper = mountField(24)

    await wrapper.find('.dt-t2-len').trigger('focusin')
    await wrapper.find('input').setValue('5e')
    await wrapper.find('.dt-t2-len').trigger('focusout')

    expect(wrapper.find('input').element.value).toBe('24')
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
