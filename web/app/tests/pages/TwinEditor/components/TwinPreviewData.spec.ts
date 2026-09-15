/** @fileoverview 模拟值编辑只发出预览覆盖事件，明确区分无数据。 */
import { normalizeTwinConfig, twinSceneValues } from '@dt/twin-config'
import { DtInput, DtSwitch } from '@dt/ui'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TwinPreviewData from '@/pages/TwinEditor/components/TwinPreviewData.vue'
import { previewDataRows } from '@/pages/TwinEditor/scripts/previewData'
it('填写零值、无数据和恢复实时分别发出明确事件', async () => {
  const config = normalizeTwinConfig({
    panels: [{ id: 'p', name: '牌', fields: [{ key: 't', label: '温度' }] }],
  })
  const wrapper = mount(TwinPreviewData, {
    props: {
      rows: previewDataRows(config, { kind: 'panels', id: 'p' }, null),
      values: twinSceneValues(config, { panelValues: [{ value: 12 }] }),
      samples: {},
      enabled: true,
    },
  })
  wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '0')
  expect(wrapper.emitted('write')).toEqual([[{ key: 'panels:p::t', value: 0 }]])
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '无数据')
    ?.trigger('click')
  expect(wrapper.emitted('write')?.at(-1)).toEqual([
    { key: 'panels:p::t', value: null },
  ])
  await wrapper.setProps({ samples: { 'panels:p::t': null } })
  expect(wrapper.text()).toContain('静态文案或占位符')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '恢复全部实时值')
    ?.trigger('click')
  expect(wrapper.emitted('clear')).toHaveLength(1)
  wrapper.findComponent(DtSwitch).vm.$emit('update:modelValue', false)
  await flushPromises()
  expect(wrapper.emitted('update:enabled')).toEqual([[false]])
  wrapper.unmount()
})
