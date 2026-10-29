/** @fileoverview BDM 目录选择、分页、只读状态与过期请求不覆盖。 */
import type { ModelingBdmCatalog, ModelingBdmSystems } from '@dt/contracts'
import { DtInput, DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import { BizError } from '@/api/client'
import BdmIdentifierPicker from '@/pages/Modeling/Canvas/components/BdmIdentifierPicker.vue'
import ArrayConfigInput from '@/pages/Modeling/Canvas/components/ArrayConfigInput.vue'
import {
  defaultsOf,
  fieldsOf,
} from '@/pages/Modeling/Canvas/scripts/schemaForm'

const fields = fieldsOf({
  type: 'object',
  required: ['identifiers'],
  properties: {
    identifiers: {
      type: 'array',
      title: '取数标识',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 10,
      'x-dt-widget': 'bdm-identifiers',
    },
  },
})
const field = fields[0]
if (field === undefined) throw new Error('Missing identifiers schema')

function page(
  kind: ModelingBdmCatalog['kind'] = 'point',
  name = '温度',
): ModelingBdmCatalog {
  return {
    kind,
    total: 100,
    page: 1,
    size: 50,
    system_filter_available: false,
    items: [
      {
        identifier: 'p1',
        code: 'P_1',
        name,
        system: null,
        history_available: true,
      },
    ],
  }
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.spyOn(modeling, 'listModelingBdmSystems').mockResolvedValue({
    items: [],
    system_filter_available: false,
  })
})

describe('BDM 取数参数', () => {
  it('点位可以按完整编码精确搜索，不同时发送名称条件', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    const mode = wrapper
      .findAllComponents(DtSelect)
      .find((select) => select.props('label') === '查找方式')
    expect(mode).toBeDefined()
    mode?.vm.$emit('update:modelValue', 'code')
    await wrapper.get('.dt-bdm-picker__search input').setValue('P_1')
    await wrapper
      .get('.dt-bdm-picker__search input')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      code: 'P_1',
      page: 1,
    })
    expect(request.mock.calls.at(-1)?.[0].name).toBeUndefined()
    wrapper.unmount()
  })

  it('跨页选中的名称可读并能单独移除，手填入口默认折叠', async () => {
    vi.spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValueOnce(page())
      .mockResolvedValue({ ...page(), items: [], page: 2 })
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: ['p1'], isReadonly: false },
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="已选数据"]').text()).toContain('温度')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    await wrapper.get('button[aria-label="移除 温度"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]])
    wrapper.unmount()
  })

  it('上游不支持系统筛选时提示原因且仍能搜索名称', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('当前数据源不支持点位系统筛选')
    expect(
      wrapper
        .findAllComponents(DtSelect)
        .some((select) => select.props('label') === '点位所属系统'),
    ).toBe(false)
    const input = wrapper.get('.dt-bdm-picker__search input')
    expect(input.attributes('maxlength')).toBe('100')
    await input.setValue(' 温度 ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'point',
      page: 1,
      name: '温度',
      system: '',
    })
    wrapper.unmount()
  })

  it('点位系统采用接口的实际分类，与名称条件一起提交', async () => {
    vi.mocked(modeling.listModelingBdmSystems).mockResolvedValue({
      items: ['空压系统'],
      system_filter_available: true,
    })
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    const select = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '点位所属系统')
    if (!select) throw new Error('Missing system selector')
    expect(select.props('options')).toEqual([
      { value: '', label: '全部系统' },
      { value: '空压系统', label: '空压系统' },
    ])
    select.vm.$emit('update:modelValue', '空压系统')
    await wrapper.get('.dt-bdm-picker__search input').setValue('压力')
    await wrapper
      .get('.dt-bdm-picker__search input')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'point',
      page: 1,
      name: '压力',
      system: '空压系统',
    })
    wrapper.unmount()
  })

  it('属性系统精确筛选在查询时回到首页，翻页保持已提交条件', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page('raw'))
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'raw', field, modelValue: ['kept'], isReadonly: false },
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')
      ?.trigger('click')
    await flushPromises()
    const system = wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '属性所属系统')
    expect(system).toBeDefined()
    await system?.get('input').setValue(' 空压系统 ')
    const input = wrapper.get('.dt-bdm-picker__search input')
    await input.setValue(' 功率 ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'raw',
      page: 1,
      name: '功率',
      system: '空压系统',
    })
    await input.setValue('尚未提交')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')
      ?.trigger('click')
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'raw',
      page: 2,
      name: '功率',
      system: '空压系统',
    })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('系统分类失败可以独立重试且不阻断目录', async () => {
    vi.mocked(modeling.listModelingBdmSystems).mockRejectedValueOnce(
      new Error('offline'),
    )
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('系统分类读取失败')
    expect(wrapper.text()).toContain('温度')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重试系统分类')
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('系统分类读取失败')
    expect(wrapper.text()).toContain('当前数据源不支持点位系统筛选')
    wrapper.unmount()
  })

  it('空搜索结果显示零项并可刷新，不当作接口失败', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue({ ...page('formula'), total: 0, items: [] })
    const wrapper = mount(BdmIdentifierPicker, {
      props: {
        kind: 'formula',
        field,
        modelValue: ['kept'],
        isReadonly: false,
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('共 0 项')
    expect(wrapper.text()).toContain('没有匹配项')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新目录')
      ?.trigger('click')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('同名项通过真实标识区分，并展示单位与系统', async () => {
    const base = page('raw')
    const item = base.items[0]
    if (item === undefined) throw new Error('Missing fixture')
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockResolvedValue({
      ...base,
      items: [
        {
          ...item,
          identifier: 'first',
          code: 'first',
          system: '空压',
          unit: 'kW',
        },
        {
          ...item,
          identifier: 'second',
          code: 'second',
          system: '空调',
          unit: 'kW',
        },
      ],
    })
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'raw', field, modelValue: ['first'], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('空压 · kW')
    expect(wrapper.text()).toContain('空调 · kW')
    await wrapper.findAll('input[type="checkbox"]').at(1)?.setValue(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      ['first', 'second'],
    ])
    wrapper.unmount()
  })

  it('不可查询点位不能新增选择，但允许移除已有选择', async () => {
    const base = page()
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockResolvedValue({
      ...base,
      items: base.items.map((item) => ({
        ...item,
        history_available: false,
        table_type: 'Run',
      })),
    })
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(
      wrapper.get('input[type="checkbox"]').attributes('disabled'),
    ).toBeDefined()
    expect(wrapper.text()).toContain('无可查询的历史字段')
    expect(wrapper.text()).toContain('Run')
    await wrapper.setProps({ modelValue: ['p1'] })
    expect(
      wrapper.get('input[type="checkbox"]').attributes('disabled'),
    ).toBeUndefined()
    await wrapper.get('input[type="checkbox"]').setValue(false)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([[]])
    wrapper.unmount()
  })

  it('快速往返类别后旧系统分类不得覆盖新选项', async () => {
    let resolveOld: (value: ModelingBdmSystems) => void = () => undefined
    const old = new Promise<ModelingBdmSystems>((resolve) => {
      resolveOld = resolve
    })
    const systems = vi
      .mocked(modeling.listModelingBdmSystems)
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce({
        items: ['新系统'],
        system_filter_available: true,
      })
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockImplementation((query) =>
      Promise.resolve(page(query.kind)),
    )
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await wrapper.setProps({ kind: 'raw' })
    expect(systems.mock.calls[0]?.[0]?.aborted).toBe(true)
    await wrapper.setProps({ kind: 'point' })
    await flushPromises()
    expect(systems).toHaveBeenCalledTimes(2)
    resolveOld({ items: ['旧系统'], system_filter_available: true })
    await flushPromises()
    const select = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '点位所属系统')
    expect(select?.props('options')).toEqual([
      { value: '', label: '全部系统' },
      { value: '新系统', label: '新系统' },
    ])
    wrapper.unmount()
  })

  it('关闭面板取消目录和系统分类请求', () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockReturnValue(new Promise(() => undefined))
    vi.mocked(modeling.listModelingBdmSystems).mockReturnValue(
      new Promise(() => undefined),
    )
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    expect(wrapper.text()).toContain('正在读取目录')
    const signal = request.mock.calls[0]?.[1]
    const systemsSignal = vi.mocked(modeling.listModelingBdmSystems).mock
      .calls[0]?.[0]
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
    expect(systemsSignal?.aborted).toBe(true)
  })

  it.each(['raw', 'formula'] as const)('%s 目录提供搜索入口', async (kind) => {
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockResolvedValue(page(kind))
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind, field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.find('.dt-bdm-picker__search input').exists()).toBe(true)
    expect(
      wrapper.findAll('button').some((button) => button.text() === '查询'),
    ).toBe(true)
    wrapper.unmount()
  })

  it('新建节点的标识初值是数组', () => {
    expect(defaultsOf(fields)).toEqual({ identifiers: [] })
  })

  it.each(['raw', 'formula'] as const)(
    '%s 名称搜索只读取过滤后的单页并保留已选标识',
    async (kind) => {
      const records = Array.from({ length: 201 }, (_, index) => ({
        identifier: `id-${index}`,
        code: `CODE_${index}`,
        name: index === 200 ? '目标温度' : `普通记录 ${index}`,
        system: null,
        history_available: null,
      }))
      const request = vi
        .spyOn(modeling, 'listModelingBdmCatalog')
        .mockImplementation((query) => {
          const size = query.size ?? 50
          const matches = records.filter((item) =>
            item.name.includes(query.name ?? ''),
          )
          return Promise.resolve({
            kind,
            page: query.page,
            size,
            total: matches.length,
            system_filter_available: null,
            items: matches.slice((query.page - 1) * size, query.page * size),
          })
        })
      const wrapper = mount(BdmIdentifierPicker, {
        props: { kind, field, modelValue: ['kept'], isReadonly: false },
      })
      await flushPromises()
      expect(wrapper.text()).not.toContain('目标温度')
      await wrapper.get('.dt-bdm-picker__search input').setValue('目标')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '查询')
        ?.trigger('click')
      await vi.waitFor(() => expect(wrapper.text()).toContain('目标温度'))
      expect(request).toHaveBeenCalledTimes(2)
      expect(request.mock.calls.at(-1)?.[0]).toEqual({
        kind,
        page: 1,
        name: '目标',
        system: '',
      })
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
      await wrapper.get('input[type="checkbox"]').setValue(true)
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
        ['kept', 'id-200'],
      ])
      wrapper.unmount()
    },
  )

  it('从真实目录标识选择并支持手填多个值', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(request.mock.calls[0]?.[0]).toEqual({
      kind: 'point',
      page: 1,
      name: '',
      system: '',
    })
    expect(wrapper.get('input[type="checkbox"]').attributes('aria-label')).toBe(
      '温度（P_1）',
    )
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['p1']])
    await wrapper.getComponent(ArrayConfigInput).get('input').setValue('p1,p2')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['p1', 'p2']])
    wrapper.unmount()
  })

  it('翻页保留已选标识且只读时不能修改', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: ['p2'], isReadonly: true },
    })
    await flushPromises()
    expect(
      wrapper.get('input[type="checkbox"]').attributes('disabled'),
    ).toBeDefined()
    const next = wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')
    expect(next).toBeDefined()
    await next?.trigger('click')
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0].page).toBe(2)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('快速换类别后旧目录不得覆盖新目录', async () => {
    let resolveOld: (value: ModelingBdmCatalog) => void = () => undefined
    const old = new Promise<ModelingBdmCatalog>((resolve) => {
      resolveOld = resolve
    })
    vi.spyOn(modeling, 'listModelingBdmCatalog')
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(page('formula', '用电公式'))
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await wrapper.setProps({ kind: 'formula' })
    await flushPromises()
    resolveOld(page('point', '过期点位'))
    await flushPromises()
    expect(wrapper.text()).toContain('用电公式')
    expect(wrapper.text()).not.toContain('过期点位')
    wrapper.unmount()
  })

  it('目录请求失败显示错误与重试入口', async () => {
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockRejectedValue(
      new BizError(51401, '目录不可用', 503, 'test-trace'),
    )
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'raw', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(
      wrapper
        .findAll('[role="alert"]')
        .map((item) => item.text())
        .join(' '),
    ).toContain('目录不可用')
    expect(wrapper.text()).toContain('重试目录')
    expect(wrapper.text()).not.toContain('本页没有可选项')
    wrapper.unmount()
  })
})
