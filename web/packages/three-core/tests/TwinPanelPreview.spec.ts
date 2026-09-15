/** @fileoverview 平面卡片预览复用运行态字段渲染与安全文本。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TwinPanelPreview from '../src/TwinPanelPreview.vue'
it('显示实时值、零值与无数据，样式和字段修改同步', async () => {
  const panel = normalizeTwinConfig({
    panels: [
      {
        id: 'p',
        name: '<img src=x>',
        fields: [{ key: 't', label: '温度', unit: '℃', decimals: 1 }],
      },
    ],
  }).panels[0]
  if (panel === undefined) throw new Error('missing panel')
  const wrapper = mount(TwinPanelPreview, {
    props: { panel, values: { 'p::t': { value: 12.5 } } },
  })
  expect(wrapper.text()).toContain('12.5')
  expect(wrapper.find('img').exists()).toBe(false)
  await wrapper.setProps({ values: { 'p::t': { value: 0 } } })
  expect(wrapper.text()).toContain('0.0')
  await wrapper.setProps({ values: { 'p::t': { value: null } } })
  expect(wrapper.text()).toContain('—')
  await wrapper.setProps({
    panel: {
      ...panel,
      name: '新的标题',
      style: { ...panel.style, variant: 'tag' },
    },
  })
  expect(wrapper.text()).toContain('新的标题')
  expect(wrapper.find('.twin-panel--tag').exists()).toBe(true)
  wrapper.unmount()
})
