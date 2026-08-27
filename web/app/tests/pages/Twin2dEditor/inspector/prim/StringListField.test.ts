/**
 * @fileoverview 契约：名单那一格只按逗号切、逐段 trim，框里留用户敲的原文。
 *
 * ⚠ 按空白切会把「一号 机组」拆成两个值，而两个值都对不上任何一个节点——零报错。
 * ⚠ 不留原文的话，`a, b` 删掉末位后那个空格会被一并吃掉，再打就成了 `a,b`。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StringListField from '@/pages/Twin2dEditor/components/inspector/prim/StringListField.vue'

function mountField(modelValue: readonly string[]) {
  return mount(StringListField, { props: { modelValue, label: '名单' } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): readonly string[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回名单')
  return events[events.length - 1]?.[0] as readonly string[]
}

describe('回显', () => {
  it('用逗号加空格拼回去', () => {
    expect(mountField(['a', 'b']).find('input').element.value).toBe('a, b')
  })
})

describe('切分', () => {
  it('半角与全角逗号都当分隔', async () => {
    const wrapper = mountField([])

    await wrapper.find('input').setValue('a，b, c')

    expect(lastWrite(wrapper)).toEqual(['a', 'b', 'c'])
  })

  // ⚠ 值里的空格是内容的一部分，不是分隔
  it('不按空白切，段内空格留着', async () => {
    const wrapper = mountField([])

    await wrapper.find('input').setValue('一号 机组, 二号')

    expect(lastWrite(wrapper)).toEqual(['一号 机组', '二号'])
  })

  it('空段丢掉', async () => {
    const wrapper = mountField([])

    await wrapper.find('input').setValue('a, , b,')

    expect(lastWrite(wrapper)).toEqual(['a', 'b'])
  })
})

describe('焦点', () => {
  it('焦点在里面时外面的值盖不掉正敲着的原文', async () => {
    const wrapper = mountField(['a'])

    await wrapper.find('.dt-t2-list').trigger('focusin')
    await wrapper.find('input').setValue('a, ')
    await wrapper.setProps({ modelValue: ['a'] })

    expect(wrapper.find('input').element.value).toBe('a, ')
  })

  it('失焦把框拨回文档里的值并转出一次 blur', async () => {
    const wrapper = mountField(['a'])

    await wrapper.find('.dt-t2-list').trigger('focusin')
    await wrapper.find('input').setValue('a,,')
    await wrapper.find('.dt-t2-list').trigger('focusout')

    expect(wrapper.find('input').element.value).toBe('a')
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
