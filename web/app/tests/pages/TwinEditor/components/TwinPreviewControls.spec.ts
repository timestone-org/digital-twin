/** @fileoverview 预览工具栏动作、距离提示与单段选择。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { DtSegmented, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import TwinPreviewControls from '@/pages/TwinEditor/components/TwinPreviewControls.vue'
it('近远动作和当前视距验证分别发出命令', async () => {
  const config = normalizeTwinConfig({
    parts: [{ id: 'p', visibility: { visible: false } }],
  })
  const wrapper = mount(TwinPreviewControls, {
    props: {
      config,
      selection: { kind: 'parts', id: 'p' },
      partMode: 'model',
      segmentKey: '',
      progress: { segmentIndex: 0, percent: 0, playing: false },
      result: '',
    },
  })
  expect(wrapper.text()).toContain('临时显示当前对象')
  wrapper.findComponent(DtSegmented).vm.$emit('update:modelValue', 'click')
  expect(wrapper.emitted('update:partMode')).toEqual([['click']])
  await wrapper.setProps({ partMode: 'click' })
  for (const label of ['预演近距动作', '预演远距动作', '按当前视距测试'])
    await wrapper
      .findAll('button')
      .find((button) => button.text() === label)
      ?.trigger('click')
  expect(wrapper.emitted('action')).toEqual([['near'], ['far'], ['click']])
  await wrapper.setProps({ partMode: 'detail', result: '已打开完整详情' })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '打开完整详情弹窗')
    ?.trigger('click')
  expect(wrapper.emitted('action')?.at(-1)).toEqual(['detail'])
  expect(wrapper.text()).toContain('已打开完整详情')
  wrapper.unmount()
})
it('空漫游提示缺少视点，选择单段与进度不改变配置', () => {
  const config = normalizeTwinConfig({})
  const wrapper = mount(TwinPreviewControls, {
    props: {
      config,
      selection: { kind: 'roam' },
      partMode: 'model',
      segmentKey: '',
      progress: { segmentIndex: 0, percent: 0, playing: false },
      result: '',
    },
  })
  expect(wrapper.text()).toContain('至少配置两个有效视点')
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'a:b')
  expect(wrapper.emitted('update:segmentKey')).toEqual([['a:b']])
  expect(config.roamTour.items).toEqual([])
  wrapper.unmount()
})
