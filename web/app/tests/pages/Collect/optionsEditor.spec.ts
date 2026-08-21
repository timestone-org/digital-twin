/**
 * @fileoverview 连接参数键值编辑器的空态与增删：没有参数时给行内空态而不是
 * 一片空白，加行/删行时空态跟着出没；空键的行不进提交。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OptionsEditor from '@/pages/Collect/Opcua/components/OptionsEditor.vue'

function render(modelValue: Record<string, string> = {}) {
  return mount(OptionsEditor, { props: { modelValue } })
}

describe('空态', () => {
  it('没有参数时给行内空态：单行、不带图标', () => {
    const empty = render().get('.dt-empty--inline')

    expect(empty.text()).toContain('还没有连接参数')
    expect(empty.find('svg').exists()).toBe(false)
  })

  it('有参数时不摆空态', () => {
    expect(render({ cert_path: '/a' }).find('.dt-empty--inline').exists()).toBe(
      false,
    )
  })

  it('添加一行后空态收起，删掉唯一一行空态回来', async () => {
    const wrapper = render()
    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('添加参数'))
    if (!add) throw new Error('没有「添加参数」键')

    await add.trigger('click')
    expect(wrapper.find('.dt-empty--inline').exists()).toBe(false)

    await wrapper.get('button[aria-label="删除这一行"]').trigger('click')
    expect(wrapper.find('.dt-empty--inline').exists()).toBe(true)
  })
})

describe('提交口径', () => {
  it('键为空的行整行丢掉，不提交一个空键', async () => {
    const wrapper = render()
    const add = wrapper
      .findAll('button')
      .find((item) => item.text().includes('添加参数'))
    await add?.trigger('click')

    const inputs = wrapper.findAll('input')
    await inputs[1]?.setValue('孤零零的值')
    await inputs[1]?.trigger('blur')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{}])
  })
})
