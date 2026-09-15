/** @fileoverview 批量操作必须先选范围、核对变化，点位校验失效后不可应用。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { DtCheckbox, DtInput } from '@dt/ui'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import TwinBatchConfig from '@/pages/TwinEditor/components/TwinBatchConfig.vue'
import { createBinding } from '@/features/dashboard/editorDoc'
import { validateReplacementPoints } from '@/pages/TwinEditor/scripts/pointBatchValidation'
vi.mock('@/pages/TwinEditor/scripts/pointBatchValidation', () => ({
  validateReplacementPoints: vi.fn(),
}))
function field(wrapper: VueWrapper, label: string) {
  const input = wrapper
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === label)
  if (input === undefined) throw new Error(`找不到字段 ${label}`)
  return input
}
function button(wrapper: VueWrapper, label: string) {
  const target = wrapper.findAll('button').find((item) => item.text() === label)
  if (target === undefined) throw new Error(`找不到按钮 ${label}`)
  return target
}
const SOURCE = '0192f0aa-0000-7000-8000-000000000001'
it('只复制选中的部件，显示影响数并一次发出草稿', async () => {
  const config = normalizeTwinConfig({
    parts: [
      { id: 'a', name: '来源', look: { color: '#ff0000' } },
      { id: 'b', name: '目标' },
    ],
  })
  const wrapper = mount(TwinBatchConfig, {
    props: {
      open: true,
      config,
      bindings: [],
      selection: { kind: 'parts', id: 'a' },
      animation: null,
    },
    global: { stubs: { teleport: true } },
  })
  const target = wrapper
    .findAllComponents(DtCheckbox)
    .find((item) => item.props('label') === '目标')
  if (target === undefined) throw new Error('没有目标勾选框')
  target.vm.$emit('update:modelValue', true)
  await flushPromises()
  expect(wrapper.text()).toContain('将更新 1 个部件')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '应用到草稿')
    ?.trigger('click')
  expect(wrapper.emitted('copy')?.[0]?.[0]).toMatchObject({
    parts: [{ id: 'a' }, { id: 'b', look: { color: '#ff0000' } }],
  })
  expect(wrapper.emitted('update:open')).toEqual([[false]])
  expect(config.parts[1]?.look.color).toBe('')
  wrapper.unmount()
})
it('替换前必须校验，修改替换文本会作废校验', async () => {
  const config = normalizeTwinConfig({
    panels: [{ id: 'p', name: '温度牌', fields: [{ key: 't' }] }],
  })
  const binding = {
    ...createBinding('n', 'panelValues[0].value'),
    sourceKind: 'opcua' as const,
    nodeKey: `${SOURCE}:pump1`,
  }
  const wrapper = mount(TwinBatchConfig, {
    props: {
      open: true,
      config,
      bindings: [binding],
      selection: { kind: 'panels', id: 'p' },
      animation: null,
    },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  const target = wrapper
    .findAllComponents(DtCheckbox)
    .find((item) => item.props('label') === '温度牌')
  if (target === undefined) throw new Error('没有目标')
  target.vm.$emit('update:modelValue', true)
  field(wrapper, '查找点位身份中的文本').vm.$emit('update:modelValue', 'pump1')
  field(wrapper, '替换为').vm.$emit('update:modelValue', 'pump2')
  await flushPromises()
  expect(wrapper.text()).toContain('将替换 1 条绑定')
  const apply = () => button(wrapper, '应用到草稿')
  expect(apply().attributes('disabled')).toBeDefined()
  vi.mocked(validateReplacementPoints).mockResolvedValue([
    { key: `${SOURCE}:pump2`, valid: true, message: '二号泵' },
  ])
  await button(wrapper, '校验目标点位').trigger('click')
  await flushPromises()
  expect(validateReplacementPoints).toHaveBeenCalled()
  expect(wrapper.text()).toContain('二号泵')
  expect(apply().attributes('disabled')).toBeUndefined()
  field(wrapper, '替换为').vm.$emit('update:modelValue', 'pump3')
  await flushPromises()
  expect(apply().attributes('disabled')).toBeDefined()
  expect(wrapper.emitted('replace')).toBeUndefined()
  field(wrapper, '替换为').vm.$emit('update:modelValue', 'pump2')
  await flushPromises()
  await button(wrapper, '校验目标点位').trigger('click')
  await flushPromises()
  await apply().trigger('click')
  expect(wrapper.emitted('replace')?.[0]?.[0]).toMatchObject([
    { id: binding.id, nodeKey: `${SOURCE}:pump2` },
  ])
  wrapper.unmount()
  vi.restoreAllMocks()
})
it('全选只作用于当前结果，筛选后取消不丢失隐藏的已选目标', async () => {
  const config = normalizeTwinConfig({
    parts: [
      {
        id: 'a',
        name: '来源',
        look: { color: '#ff0000' },
        detail: { width: 1400 },
      },
      { id: 'b', name: '泵1' },
      { id: 'c', name: '泵2' },
      { id: 'd', name: '风机' },
    ],
  })
  const wrapper = mount(TwinBatchConfig, {
    props: {
      open: true,
      config,
      bindings: [],
      selection: { kind: 'parts', id: 'a' },
      animation: null,
    },
    global: { stubs: { teleport: true } },
  })
  await button(wrapper, '全选当前结果').trigger('click')
  expect(wrapper.text()).toContain('已选 3 / 3')
  field(wrapper, '目标对象').vm.$emit('update:modelValue', '泵')
  await flushPromises()
  await button(wrapper, '取消当前结果').trigger('click')
  expect(wrapper.text()).toContain('已选 1 / 3')
  await button(wrapper, '全选当前结果').trigger('click')
  const look = wrapper
    .findAllComponents(DtCheckbox)
    .find((item) => item.props('label') === '常态外观')
  const style = wrapper
    .findAllComponents(DtCheckbox)
    .find((item) => item.props('label') === '详情样式')
  if (look === undefined || style === undefined) throw new Error('缺少复制选项')
  look.vm.$emit('update:modelValue', false)
  style.vm.$emit('update:modelValue', true)
  await flushPromises()
  expect(wrapper.text()).toContain('将更新 3 个部件')
  await button(wrapper, '应用到草稿').trigger('click')
  expect(wrapper.emitted('copy')?.[0]?.[0]).toMatchObject({
    parts: [
      { id: 'a' },
      { id: 'b', detail: { width: 1400 } },
      { id: 'c', detail: { width: 1400 } },
      { id: 'd', detail: { width: 1400 } },
    ],
  })
  wrapper.unmount()
})
