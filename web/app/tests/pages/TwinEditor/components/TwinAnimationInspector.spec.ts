/** @fileoverview 动画目录选择、播放规则与点位选择的真实组件契约。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { DtSelect, DtSwitch, DtNumberInput, DtInput } from '@dt/ui'
import TwinAnimationInspector from '@/pages/TwinEditor/components/TwinAnimationInspector.vue'
import TwinAnimationList from '@/pages/TwinEditor/components/TwinAnimationList.vue'
const config = normalizeTwinConfig({
  model: { animations: { controls: [{ clip: 'pump', mode: 'point' }] } },
})
it('目录展示动画并选中，保留缺失的动画配置', async () => {
  const wrapper = mount(TwinAnimationList, {
    props: { config: config.model.animations, clips: [], selected: null },
  })
  expect(wrapper.text()).toContain('模型中已缺失')
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('select')).toEqual([['pump']])
  wrapper.unmount()
})
it('直接选择当前动画点位，试播不写配置，规则变更通过patch', async () => {
  const wrapper = mount(TwinAnimationInspector, {
    props: {
      config,
      clip: 'pump',
      bindings: [],
      value: 1,
      available: true,
      isDirty: true,
      testMode: 'live',
    },
  })
  expect(wrapper.text()).toContain('条件命中：播放')
  const buttons = wrapper.findAll('button')
  await buttons.find((button) => button.text() === '选择点位')?.trigger('click')
  expect(wrapper.emitted('pick')).toEqual([['animationValues[0].value']])
  await buttons.find((button) => button.text() === '单独试播')?.trigger('click')
  expect(wrapper.emitted('test')).toEqual([['play']])
  expect(wrapper.emitted('patch')).toBeUndefined()
  wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '一号水泵')
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'always')
  wrapper.findComponent(DtNumberInput).vm.$emit('update:modelValue', 2)
  wrapper.findComponent(DtSwitch).vm.$emit('update:modelValue', false)
  expect(wrapper.emitted('patch')).toHaveLength(4)
  await wrapper.setProps({ value: null })
  expect(wrapper.text()).toContain('数据未知')
  await wrapper.setProps({ testMode: 'pause' })
  expect(wrapper.text()).toContain('临时试播中')
  await wrapper.setProps({ available: false })
  expect(wrapper.text()).toContain('原配置和绑定已保留')
  wrapper.unmount()
})
it('无规则动画首次修改创建规则，枚举输入只接受有效值', async () => {
  const wrapper = mount(TwinAnimationInspector, {
    props: {
      config: normalizeTwinConfig({}),
      clip: 'new',
      bindings: [],
      value: {},
      available: true,
      isDirty: false,
      testMode: 'live',
    },
  })
  expect(wrapper.text()).toContain('已关闭')
  wrapper.findComponent(DtInput).vm.$emit('update:modelValue', '新增动画')
  expect(wrapper.emitted('patch')).toHaveLength(1)
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'invalid')
  expect(wrapper.emitted('patch')).toHaveLength(1)
  await wrapper.setProps({ config })
  wrapper.unmount()
})
it('修改条件、无数据和停止策略，切换实际状态', async () => {
  const wrapper = mount(TwinAnimationInspector, {
    props: {
      config,
      clip: 'pump',
      bindings: [],
      value: 0,
      available: true,
      isDirty: false,
      testMode: 'live',
    },
  })
  expect(wrapper.text()).toContain('条件未命中')
  const selects = wrapper.findAllComponents(DtSelect)
  selects[1]?.vm.$emit('update:modelValue', 'gt')
  selects[2]?.vm.$emit('update:modelValue', 'reset')
  selects[3]?.vm.$emit('update:modelValue', 'reset')
  selects[3]?.vm.$emit('update:modelValue', 'invalid')
  wrapper.findAllComponents(DtSwitch)[1]?.vm.$emit('update:modelValue', true)
  wrapper
    .findAllComponents(DtNumberInput)[1]
    ?.vm.$emit('update:modelValue', undefined)
  expect(wrapper.emitted('patch')).toHaveLength(5)
  await wrapper.setProps({
    config: normalizeTwinConfig({
      model: { animations: { controls: [{ clip: 'pump', mode: 'always' }] } },
    }),
  })
  expect(wrapper.text()).toContain('固定播放')
  wrapper.unmount()
})
it('目录搜索、独立状态与重名动画禁用', async () => {
  const clips = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({
    name,
    nodes: [],
    duration: 1,
    ambiguous: name === 'f',
  }))
  const model = normalizeTwinConfig({
    model: {
      animations: {
        controls: [
          { clip: 'a', mode: 'always' },
          { clip: 'b', mode: 'point' },
          { clip: 'c', mode: 'off' },
        ],
      },
    },
  }).model.animations
  const wrapper = mount(TwinAnimationList, {
    props: { config: model, clips, selected: 'a' },
  })
  expect(wrapper.text()).toContain('固定播放')
  expect(wrapper.text()).toContain('点位控制')
  expect(wrapper.text()).toContain('已关闭')
  expect(
    wrapper
      .findAll('button')
      .some((button) => button.attributes('disabled') !== undefined),
  ).toBe(true)
  wrapper.findComponent(DtInput).vm.$emit('update:modelValue', 'not-found')
  await flushPromises()
  expect(wrapper.text()).toContain('没有匹配的动画')
  wrapper.unmount()
})
