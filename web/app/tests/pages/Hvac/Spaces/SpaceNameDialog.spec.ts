/**
 * @fileoverview 车间/房间命名弹窗：回车只提交一次，在飞时不再提交。
 * ⚠ DtInput 的 enter 与表单的隐式提交会同时触发，两条都接上就是同一个 POST 发两遍。
 */
import { describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach } from 'vitest'

import SpaceNameDialog from '@/pages/Hvac/Spaces/components/SpaceNameDialog.vue'

enableAutoUnmount(afterEach)

function open(isBusy = false) {
  return mount(SpaceNameDialog, {
    props: {
      modelValue: true,
      title: '新建车间',
      description: '',
      initial: '东车间',
      isBusy,
      error: null,
    },
    global: { stubs: { teleport: true } },
  })
}

describe('提交', () => {
  it('⚠ 回车只提交一次', async () => {
    const wrapper = open()
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('在飞时不再提交', async () => {
    const wrapper = open(true)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
