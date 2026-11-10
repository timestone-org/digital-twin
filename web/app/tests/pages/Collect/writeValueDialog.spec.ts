/** @fileoverview 写值弹窗：改了值就换幂等键，原值重复提交沿用同一个键。 */
import { afterEach, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import WriteValueDialog from '@/pages/Collect/components/WriteValueDialog.vue'
import { POINT } from '@/testing/knowledgeLive'

enableAutoUnmount(afterEach)

async function render(): Promise<VueWrapper> {
  const wrapper = mount(WriteValueDialog, {
    props: {
      modelValue: true,
      point: { ...POINT, data_type: 'float' },
      sample: undefined,
    },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

async function send(wrapper: VueWrapper, value: string): Promise<string> {
  await wrapper.find('input').setValue(value)
  const button = wrapper.findAll('button').find((one) => one.text() === '下发')
  if (button === undefined) throw new Error('没有下发按钮')
  await button.trigger('click')
  const all = wrapper.emitted<[{ value: unknown; key: string }]>('write') ?? []
  const last = all[all.length - 1]
  if (last === undefined) throw new Error('没有发出写值')
  return last[0].key
}

it('改了要下发的值就换幂等键，免得服务端回放上一次的成功', async () => {
  const wrapper = await render()
  const first = await send(wrapper, '1')
  const again = await send(wrapper, '1')
  const changed = await send(wrapper, '2')
  expect(again).toBe(first)
  expect(changed).not.toBe(first)
})
