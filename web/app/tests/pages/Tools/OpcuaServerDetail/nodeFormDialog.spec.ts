/** @fileoverview 节点创建初值保持后端要求的 JSON 类型。 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type {
  OpcuaDataType,
  OpcuaNode,
  OpcuaNodeCreateInput,
} from '@dt/contracts'
import { DtField, DtInput, DtSelect } from '@dt/ui'

import NodeFormDialog from '@/pages/Tools/OpcuaServerDetail/components/NodeFormDialog.vue'

enableAutoUnmount(afterEach)

async function fill(
  wrapper: VueWrapper,
  label: string,
  value: string,
): Promise<void> {
  const field = wrapper
    .findAllComponents(DtField)
    .find((one) => one.props('label') === label)
  if (field === undefined) throw new Error(`缺少字段 ${label}`)
  field.findComponent(DtInput).vm.$emit('update:modelValue', value)
  await flushPromises()
}

async function render(
  dataType: OpcuaDataType,
  initial: string,
): Promise<VueWrapper> {
  const wrapper = mount(NodeFormDialog, {
    props: { modelValue: false, nodes: [] },
    global: { stubs: { Teleport: true } },
  })
  await wrapper.setProps({ modelValue: true })
  await fill(wrapper, '标识', 'Artificial.Temperature')
  await fill(wrapper, 'BrowseName', 'Temperature')
  const field = wrapper
    .findAllComponents(DtField)
    .find((one) => one.props('label') === '数据类型')
  field?.findComponent(DtSelect).vm.$emit('update:modelValue', dataType)
  await flushPromises()
  await fill(wrapper, '初值', initial)
  return wrapper
}

async function submit(wrapper: VueWrapper): Promise<void> {
  const button = wrapper.findAll('button').find((one) => one.text() === '创建')
  if (button === undefined) throw new Error('没有创建按钮')
  await button.trigger('click')
}

describe('节点初值', () => {
  it.each<{ dataType: OpcuaDataType; raw: string; expected: unknown }>([
    { dataType: 'double', raw: '47.2', expected: 47.2 },
    { dataType: 'float', raw: '12.5', expected: 12.5 },
    { dataType: 'double', raw: '1e40', expected: 1e40 },
    { dataType: 'int32', raw: '-2147483648', expected: -2147483648 },
    { dataType: 'int64', raw: '9007199254740991', expected: 9007199254740991 },
    { dataType: 'boolean', raw: 'false', expected: false },
    { dataType: 'boolean', raw: 'true', expected: true },
    { dataType: 'string', raw: '47.2', expected: '47.2' },
    { dataType: 'byte_string', raw: '字节', expected: '字节' },
  ])(
    '$dataType 初值 $raw 保持 JSON 类型',
    async ({ dataType, raw, expected }) => {
      const wrapper = await render(dataType, raw)
      await submit(wrapper)
      const payload =
        wrapper.emitted<[OpcuaNodeCreateInput]>('create')?.[0]?.[0]
      expect(payload?.initial_value).toBe(expected)
    },
  )

  it.each<{ dataType: OpcuaDataType; raw: string }>([
    { dataType: 'double', raw: 'not-a-number' },
    { dataType: 'float', raw: '1e40' },
    { dataType: 'double', raw: 'Infinity' },
    { dataType: 'double', raw: '1e999' },
    { dataType: 'int32', raw: '2147483648' },
    { dataType: 'int32', raw: '1.5' },
    { dataType: 'int64', raw: '9007199254740992' },
    { dataType: 'boolean', raw: 'false-ish' },
    { dataType: 'boolean', raw: '1' },
  ])('$dataType 非法初值 $raw 阻止创建并提示', async ({ dataType, raw }) => {
    const wrapper = await render(dataType, raw)
    await submit(wrapper)
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(
      wrapper
        .findAllComponents(DtField)
        .find((one) => one.props('label') === '初值')
        ?.props('error'),
    ).toBeTruthy()
  })

  it('父对象和可写权限按选择提交', async () => {
    const wrapper = await render('double', '47.2')
    const parent: OpcuaNode = {
      id: 'object-1',
      instance_id: 'instance-1',
      parent_id: null,
      node_class: 'object',
      identifier: 'Artificial',
      identifier_kind: 'string',
      node_id: 'ns=2;s=Artificial',
      browse_name: '人工对象',
      data_type: null,
      value_rank: -1,
      array_dimensions: null,
      access_level: 1,
      initial_value: null,
      description: null,
      created_at: '2026-10-04T00:00:00Z',
      updated_at: '2026-10-04T00:00:00Z',
    }
    await wrapper.setProps({ nodes: [parent] })
    const fields = wrapper.findAllComponents(DtField)
    fields
      .find((one) => one.props('label') === '父节点')
      ?.findComponent(DtSelect)
      .vm.$emit('update:modelValue', parent.id)
    fields
      .find((one) => one.props('label') === '访问权限')
      ?.findComponent(DtSelect)
      .vm.$emit('update:modelValue', 'writable')
    await flushPromises()
    await submit(wrapper)
    expect(
      wrapper.emitted<[OpcuaNodeCreateInput]>('create')?.[0]?.[0],
    ).toMatchObject({
      parent_id: parent.id,
      access_level: 3,
      initial_value: 47.2,
    })
  })

  it('空初值省略字段并使用后端类型零值', async () => {
    const wrapper = await render('double', '')
    await submit(wrapper)
    const payload = wrapper.emitted<[OpcuaNodeCreateInput]>('create')?.[0]?.[0]
    expect(payload).not.toHaveProperty('initial_value')
  })

  it('对象节点不携带变量类型与访问权限', async () => {
    const wrapper = await render('double', 'invalid')
    wrapper
      .findAllComponents(DtSelect)[0]
      ?.vm.$emit('update:modelValue', 'object')
    await flushPromises()
    await submit(wrapper)
    const payload = wrapper.emitted<[OpcuaNodeCreateInput]>('create')?.[0]?.[0]
    expect(payload).toMatchObject({ node_class: 'object', parent_id: null })
    expect(payload).not.toHaveProperty('initial_value')
    expect(payload).not.toHaveProperty('data_type')
    expect(payload).not.toHaveProperty('access_level')
  })

  it('非法初值改正后可以创建', async () => {
    const wrapper = await render('boolean', 'invalid')
    await submit(wrapper)
    expect(wrapper.emitted('create')).toBeUndefined()
    await fill(wrapper, '初值', 'false')
    await submit(wrapper)
    expect(
      wrapper.emitted<[OpcuaNodeCreateInput]>('create')?.[0]?.[0]
        ?.initial_value,
    ).toBe(false)
  })

  it('取消和重开清除初值与错误，创建前须重填标识', async () => {
    const wrapper = await render('int32', 'invalid')
    const cancel = wrapper
      .findAll('button')
      .find((one) => one.text() === '取消')
    await cancel?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await submit(wrapper)
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(
      wrapper
        .findAllComponents(DtField)
        .find((one) => one.props('label') === '初值')
        ?.props('error'),
    ).toBeUndefined()
  })
})
