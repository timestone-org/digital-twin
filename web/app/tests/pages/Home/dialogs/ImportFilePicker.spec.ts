/**
 * @fileoverview 契约：选文件这一步把选中的文件抛出去、把关闭抛出去。
 * ⚠ 它单独一步存在的理由就在这条用例里：没有包的时候导入确认框只能渲染空壳。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ImportFilePicker from '@/pages/Home/components/ImportFilePicker.vue'

function mountPicker(open = true) {
  return mount(ImportFilePicker, {
    props: { open },
    global: { stubs: { Teleport: true } },
  })
}

describe('选文件', () => {
  it('关着时什么都不渲染', () => {
    expect(mountPicker(false).text()).toBe('')
  })

  it('开着时说清只认本系统导出的包', () => {
    expect(mountPicker().text()).toContain('只认本系统导出的包')
  })

  it('选中一个文件就把它抛出去', async () => {
    const wrapper = mountPicker()
    const file = new File(['{}'], 'x.json', { type: 'application/json' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })

    await input.trigger('change')

    expect(wrapper.emitted('pick')).toEqual([[file]])
  })

  it('一个文件都没选时不抛 pick', async () => {
    const wrapper = mountPicker()
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [] })

    await input.trigger('change')

    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('点取消把 update:open(false) 抛出去', async () => {
    const wrapper = mountPicker()
    const hit = wrapper
      .findAll('button')
      .find((button) => button.text().includes('取消'))

    await hit?.trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
