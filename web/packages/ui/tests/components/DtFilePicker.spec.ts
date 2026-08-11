/**
 * @fileoverview DtFilePicker 的选取与复位契约。
 * ⚠ change 之后不清空 input.value，连续选同一个文件就不会再触发 change，
 * 表现是「点了没反应」——这条只有在同一个文件选两次时才暴露。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import DtFilePicker from '../../src/components/DtFilePicker/DtFilePicker.vue'

/** happy-dom 的 FileList 只读，用 defineProperty 喂一份。 */
function attachFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
}

function textFile(name: string): File {
  return new File(['x'], name, { type: 'text/plain' })
}

function mountPicker(props: Record<string, never> | object = {}) {
  return mount(DtFilePicker, { props })
}

describe('DtFilePicker 触发器', () => {
  it('缺省渲染一个按钮，文案取 label', () => {
    const wrapper = mountPicker({ label: '导入台账' })
    expect(wrapper.find('button').text()).toBe('导入台账')
  })

  it('缺省文案是「选择文件」', () => {
    expect(mountPicker().find('button').text()).toBe('选择文件')
  })

  it('点按钮会去点隐藏的原生 input', async () => {
    const wrapper = mountPicker()
    const click = vi.spyOn(
      wrapper.get<HTMLInputElement>('input[type="file"]').element,
      'click',
    )
    await wrapper.find('button').trigger('click')
    expect(click).toHaveBeenCalledOnce()
  })

  it('disabled 时按钮点不动', async () => {
    const wrapper = mountPicker({ disabled: true })
    const click = vi.spyOn(
      wrapper.get<HTMLInputElement>('input[type="file"]').element,
      'click',
    )
    wrapper.find('button').element.dispatchEvent(new Event('click'))
    await nextTick()
    expect(click).not.toHaveBeenCalled()
  })

  it('⚠ disabled 时自备触发器调 open() 同样打不开：按钮的禁用态管不到插槽', async () => {
    const wrapper = mount(DtFilePicker, {
      props: { disabled: true },
      slots: {
        default: `<template #default="{ open }">
          <a class="custom" href="#" @click.prevent="open">自备触发区</a>
        </template>`,
      },
    })
    const click = vi.spyOn(
      wrapper.get<HTMLInputElement>('input[type="file"]').element,
      'click',
    )
    await wrapper.find('.custom').trigger('click')
    expect(click).not.toHaveBeenCalled()
  })

  it('默认插槽接管触发器，并拿到 open', async () => {
    const wrapper = mount(DtFilePicker, {
      slots: {
        default: `<template #default="{ open }">
          <a class="custom" href="#" @click.prevent="open">自备触发区</a>
        </template>`,
      },
    })
    expect(wrapper.find('button').exists()).toBe(false)
    const click = vi.spyOn(
      wrapper.get<HTMLInputElement>('input[type="file"]').element,
      'click',
    )
    await wrapper.find('.custom').trigger('click')
    expect(click).toHaveBeenCalledOnce()
  })

  it('插槽同时拿到 disabled，供自备触发器自己置灰', () => {
    const wrapper = mount(DtFilePicker, {
      props: { disabled: true },
      slots: {
        default: `<template #default="{ disabled }">
          <span class="custom">{{ disabled }}</span>
        </template>`,
      },
    })
    expect(wrapper.find('.custom').text()).toBe('true')
  })
})

describe('DtFilePicker 选取', () => {
  it('选中文件后 emit 文件数组', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    const file = textFile('a.csv')
    attachFiles(input.element, [file])
    await input.trigger('change')
    expect(wrapper.emitted('select')).toEqual([[[file]]])
  })

  it('多选时一次 emit 全部', async () => {
    const wrapper = mountPicker({ multiple: true })
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    const files = [textFile('a.csv'), textFile('b.csv')]
    attachFiles(input.element, files)
    await input.trigger('change')
    expect(wrapper.emitted('select')).toEqual([[files]])
  })

  it('取消选取（文件列表为空）不 emit', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    attachFiles(input.element, [])
    await input.trigger('change')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('files 为 null 时当成没选，不去读 length', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: null,
    })
    await input.trigger('change')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('⚠ emit 之前先清空 value：不清的话同一个文件选第二次不再触发 change', async () => {
    const wrapper = mountPicker()
    const input = wrapper.get<HTMLInputElement>('input[type="file"]')
    attachFiles(input.element, [textFile('a.csv')])
    await input.trigger('change')
    expect(input.element.value).toBe('')
  })
})

describe('DtFilePicker 原生属性', () => {
  it('accept 与 multiple 透到原生 input', () => {
    const wrapper = mountPicker({ accept: '.csv,.xlsx', multiple: true })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('accept')).toBe('.csv,.xlsx')
    expect(input.attributes('multiple')).toBe('')
  })

  it('缺省不允许多选', () => {
    expect(
      mountPicker().find('input[type="file"]').attributes('multiple'),
    ).toBeUndefined()
  })

  it('disabled 时原生 input 一并禁用', () => {
    const wrapper = mountPicker({ disabled: true })
    expect(wrapper.find('input[type="file"]').attributes('disabled')).toBe('')
  })

  it('⚠ 原生 input 退出 Tab 序并对读屏隐藏：可见的是按钮，它只是个开门器', () => {
    const input = mountPicker().find('input[type="file"]')
    expect(input.attributes('tabindex')).toBe('-1')
    expect(input.attributes('aria-hidden')).toBe('true')
  })
})
