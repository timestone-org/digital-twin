/** @fileoverview 导出与复制的点位绑定选项及取消契约。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PointBindingChoiceDialog from '@/features/dashboard/PointBindingChoiceDialog.vue'

describe('点位绑定选择', () => {
  it.each(['export', 'copy'] as const)(
    '%s 使用对应默认值，可切换并提交',
    async (operation) => {
      const wrapper = mount(PointBindingChoiceDialog, {
        props: { open: true, operation, dashboardName: '总览' },
        global: { stubs: { Teleport: true } },
      })
      const checkbox = wrapper.get<HTMLInputElement>('input[type=checkbox]')
      expect(checkbox.element.checked).toBe(operation === 'copy')
      await checkbox.setValue(operation !== 'copy')
      await wrapper.get('[data-test="confirm-transfer"]').trigger('click')
      expect(wrapper.emitted('submit')).toEqual([[operation !== 'copy']])
      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true })
      // 重开是一个新节点：弹窗走 v-if，上一轮取到的已经离开页面
      const reopened = wrapper.get<HTMLInputElement>('input[type=checkbox]')
      expect(reopened.element.checked).toBe(operation === 'copy')
      wrapper.unmount()
    },
  )

  it('取消只关闭弹窗，不提交', async () => {
    const wrapper = mount(PointBindingChoiceDialog, {
      props: { open: true, operation: 'export', dashboardName: '总览' },
      global: { stubs: { Teleport: true } },
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')
      ?.trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })
})
