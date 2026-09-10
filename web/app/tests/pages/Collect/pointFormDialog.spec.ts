/**
 * @fileoverview 契约：点位表单填了一半，误点遮罩不许把它清空。
 *
 * ⚠ 与数据源表单同一条口径。分开各钉一遍是因为「忘了把 `modelValue` 传给
 * `useFormDirty`」这种漏接不会有任何类型错误，只会让保护安静地失效。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import PointFormDialog from '@/pages/Collect/Opcua/components/PointFormDialog.vue'

async function render(): Promise<VueWrapper> {
  const wrapper = mount(PointFormDialog, {
    props: { modelValue: true, point: null, presetAddress: undefined },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

async function fillFirstText(wrapper: VueWrapper, value: string) {
  const input = wrapper.findAll('input').find((one) => {
    const type = one.attributes('type')
    return type === undefined || type === 'text'
  })
  if (input === undefined) throw new Error('弹窗里没有文本输入框')
  await input.setValue(value)
}

describe('误关保护', () => {
  it('还没动过时点外面照常关得掉', async () => {
    const wrapper = await render()

    await wrapper.find('.dt-modal__backdrop').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('⚠ 填过之后点外面不关，也不清空已经填的内容', async () => {
    const wrapper = await render()

    await fillFirstText(wrapper, 'outlet_temp')
    await wrapper.find('.dt-modal__backdrop').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('有还没提交的内容')
  })
})

it('saves a point description with the other metadata', async () => {
  const wrapper = await render()
  await wrapper.find('input[placeholder="如：outlet_temp"]').setValue('temp')
  await wrapper.find('input[placeholder="如：出口温度"]').setValue('出口温度')
  await wrapper
    .find('input[placeholder="ns=2;s=Plant1.OutletTemp"]')
    .setValue('ns=2;s=temp')
  await wrapper
    .find('input[placeholder="如：一号机出风口温度，也称送风温度"]')
    .setValue(' 一号机送风温度 ')
  const save = wrapper
    .findAll('button')
    .find((one) => /保存|创建|添加/.test(one.text()))
  expect(save).toBeDefined()
  await save?.trigger('click')
  expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
    code: 'temp',
    description: '一号机送风温度',
  })
  wrapper.unmount()
})
