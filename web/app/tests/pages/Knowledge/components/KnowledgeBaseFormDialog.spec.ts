/**
 * @fileoverview 新建知识库弹窗：回车只提交一次。
 * ⚠ DtInput 的 enter 与表单的隐式提交会同时触发，两条都接上就是同一个 POST 发两遍。
 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import KnowledgeBaseFormDialog from '@/pages/Knowledge/components/KnowledgeBaseFormDialog.vue'

enableAutoUnmount(afterEach)

function open(isBusy = false) {
  return mount(KnowledgeBaseFormDialog, {
    props: { modelValue: true, isBusy, error: '' },
    global: { stubs: { teleport: true } },
  })
}

describe('提交', () => {
  it('⚠ 回车只提交一次', async () => {
    const wrapper = open()
    await wrapper.get('input').setValue('锅炉运维手册')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([['锅炉运维手册', '']])
  })

  it('在飞时不再提交', async () => {
    const wrapper = open(true)
    await wrapper.get('input').setValue('锅炉运维手册')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
