/** @fileoverview 关联下拉按真实引用跳转，并拒绝过期选项。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TwinSelectionContext from '@/pages/TwinEditor/components/TwinSelectionContext.vue'
it('显示当前部件，关联选择返回稳定标识而不是名称', async () => {
  const config = normalizeTwinConfig({
    parts: [
      { id: 'p', name: '一号泵', nodes: ['mesh'] },
      { id: 'c', name: '叶轮', parentId: 'p' },
    ],
  })
  const wrapper = mount(TwinSelectionContext, {
    props: {
      config,
      selection: { kind: 'parts', id: 'p' },
      animation: null,
      clips: [{ name: 'spin', duration: 1, nodes: ['mesh'], ambiguous: false }],
    },
  })
  expect(wrapper.text()).toContain('部件 · 一号泵')
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'parts:c')
  expect(wrapper.emitted('select')).toEqual([[{ kind: 'parts', id: 'c' }]])
  wrapper
    .findComponent(DtSelect)
    .vm.$emit('update:modelValue', 'animation:spin')
  expect(wrapper.emitted('selectAnimation')).toEqual([['spin']])
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'parts:missing')
  expect(wrapper.emitted('select')).toHaveLength(1)
  await wrapper.setProps({ selection: { kind: 'model' }, animation: null })
  expect(wrapper.findComponent(DtSelect).exists()).toBe(false)
  wrapper.unmount()
})
