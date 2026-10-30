/** @fileoverview API 来源配置、复制、引用保护和连接目录错误表现。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { DtButton, DtInput, DtSelect, DtTextarea } from '@dt/ui'
import * as api from '@/api/reports'
import ApiSourcePanel from '@/pages/Reports/Editor/components/ApiSourcePanel.vue'
import type { ApiSource } from '@/pages/Reports/Editor/scripts/apiSourceForm'

const source: ApiSource = {
  code: 'energy',
  name: '能耗',
  connection: 'ems',
  method: 'GET',
  path: '/monthly',
  query: { start: '{{start}}' },
  columns: [{ key: 'value', name: '用电量', pointer: '/value' }],
  offset: 0,
}
afterEach(() => vi.restoreAllMocks())
function setup(sources: ApiSource[] = [source]) {
  vi.spyOn(api, 'reportApiConnections').mockResolvedValue([
    { code: 'ems', name: '能管接口' },
  ])
  return mount(ApiSourcePanel, {
    props: {
      modelValue: sources,
      metrics: [],
      document: { type: 'doc' },
      disabled: false,
    },
    global: { stubs: { teleport: true } },
  })
}
it('配置后保留报告期参数并可复制独立来源', async () => {
  const wrapper = setup()
  expect(api.reportApiConnections).not.toHaveBeenCalled()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '配置')
    ?.trigger('click')
  await flushPromises()
  expect(api.reportApiConnections).toHaveBeenCalled()
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '来源名称')
    ?.vm.$emit('update:modelValue', '新能耗')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用数据源')
    ?.trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
    expect.objectContaining({
      code: 'energy',
      name: '新能耗',
      query: { start: '{{start}}' },
    }),
  ])
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '复制')
    ?.trigger('click')
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用数据源')
    ?.trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[1]?.[0]).toEqual([
    source,
    expect.objectContaining({ code: 'energy_copy' }),
  ])
  wrapper.unmount()
})
it('被指标引用的数据源不能删除，未引用来源可删除', async () => {
  const wrapper = setup()
  await wrapper.setProps({
    metrics: [{ name: '指标', table: 'api:energy', key: 'value' }],
  })
  await wrapper.get('[aria-label="删除 API 来源 能耗"]').trigger('click')
  expect(wrapper.text()).toContain('仍被指标或正文引用')
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  await wrapper.setProps({ metrics: [] })
  await wrapper.get('[aria-label="删除 API 来源 能耗"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([])
  wrapper.unmount()
})
function sourceInputs(wrapper: ReturnType<typeof setup>) {
  return wrapper.findAllComponents(DtInput)
}
function fillSourceInputs(inputs: ReturnType<typeof sourceInputs>): void {
  const values: Record<string, string> = {
    来源名称: '接口',
    来源编码: 'energy',
    'API 相对路径': '/monthly',
  }
  fillInputs(inputs, values)
}
function fillInputs(
  inputs: ReturnType<typeof sourceInputs>,
  values: Record<string, string>,
): void {
  for (const input of inputs) {
    const label: unknown = input.props('label')
    const value = typeof label === 'string' ? values[label] : undefined
    if (value !== undefined) input.vm.$emit('update:modelValue', value)
  }
}
it('新建来源校验编码和 JSON，POST 请求体进入模板', async () => {
  const wrapper = setup([])
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '添加 API 数据源')
    ?.trigger('click')
  await flushPromises()
  fillSourceInputs(sourceInputs(wrapper))
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '已授权连接')
    ?.vm.$emit('update:modelValue', 'ems')
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '请求方式')
    ?.vm.$emit('update:modelValue', 'POST')
  await flushPromises()
  wrapper
    .findAllComponents(DtTextarea)
    .find((input) => input.props('label') === '请求体（JSON 对象）')
    ?.vm.$emit('update:modelValue', '{')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用数据源')
    ?.trigger('click')
  expect(wrapper.text()).toContain('请求体必须为有效的 JSON 对象')
  wrapper
    .findAllComponents(DtTextarea)
    .find((input) => input.props('label') === '请求体（JSON 对象）')
    ?.vm.$emit('update:modelValue', '{"period":"{{period}}"}')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用数据源')
    ?.trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
    expect.objectContaining({ method: 'POST', body: { period: '{{period}}' } }),
  ])
  wrapper.unmount()
})
it('只读状态没有任何配置写入入口', async () => {
  const wrapper = setup()
  await wrapper.setProps({ disabled: true })
  expect(wrapper.findAllComponents(DtButton)).toHaveLength(0)
  expect(api.reportApiConnections).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('映射字段和报告期参数可修改，连接错误能原位重试', async () => {
  const wrapper = setup()
  vi.mocked(api.reportApiConnections).mockRejectedValueOnce(new Error('离线'))
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '配置')
    ?.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('请求失败，请重试')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '刷新连接目录')
    ?.trigger('click')
  await flushPromises()
  fillInputs(sourceInputs(wrapper), {
    报告期偏移: '-1',
    '数据位置（JSON Pointer）': '/data',
    '时间字段（可选）': '/time',
    字段名称: '设备名称',
    字段编码: 'label',
    '字段位置（JSON Pointer）': '/label',
  })
  wrapper
    .findAllComponents(DtTextarea)
    .find((input) => input.props('label') === '查询参数（JSON 对象）')
    ?.vm.$emit('update:modelValue', '{"period":"{{period}}"}')
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '数据类型')
    ?.vm.$emit('update:modelValue', 'text')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '添加映射字段')
    ?.trigger('click')
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .filter((button) => button.text() === '移除字段')
    .at(-1)
    ?.trigger('click')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '应用数据源')
    ?.trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
    expect.objectContaining({
      offset: -1,
      rows_pointer: '/data',
      time_pointer: '/time',
      columns: [
        {
          key: 'label',
          name: '设备名称',
          pointer: '/label',
          data_type: 'text',
        },
      ],
    }),
  ])
  wrapper.unmount()
})
