/** @fileoverview 能管分时配置、有效参数联动与指标来源选择。 */
import type {
  ModelingBdmCapabilities,
  ModelingBdmIndicators,
} from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/modeling'
import BdmSourceConfigForm from '@/pages/Modeling/Canvas/components/BdmSourceConfigForm.vue'
import BdmIndicatorPicker from '@/pages/Modeling/Canvas/components/BdmIndicatorPicker.vue'
import MomentInput from '@/pages/Modeling/Canvas/components/MomentInput.vue'
import {
  BDM_MINUTE_INTERVALS,
  bdmIntervalError,
  bdmTimeError,
  changeBdmConfig,
} from '@/pages/Modeling/Canvas/scripts/bdmConfig'
import { fieldsOf } from '@/pages/Modeling/Canvas/scripts/schemaForm'

const capabilities: ModelingBdmCapabilities = {
  is_configured: true,
  timezone: 'Asia/Shanghai',
  minute_intervals: [...BDM_MINUTE_INTERVALS],
  max_identifiers: 10,
  max_formula_identifiers: 8,
  max_rows: 200000,
  load_timeout_s: 120,
}
const fields = fieldsOf({
  properties: {
    identifiers: {
      type: 'array',
      title: '取数标识',
      minItems: 1,
      maxItems: 10,
      items: { type: 'string' },
      'x-dt-widget': 'bdm-identifiers',
    },
    granularity: {
      type: 'string',
      enum: ['day', 'month', 'hour', 'minute'],
      default: 'day',
    },
    row_limit: { type: 'integer', minimum: 1, maximum: 200000, default: 50000 },
    value_type: {
      type: 'string',
      enum: ['number', 'string'],
      default: 'number',
    },
  },
})
const options = {
  tables: [],
  tablesState: 'ready' as const,
  tablesNote: '',
  columns: [],
  columnsNote: '',
}
const indicatorPage: ModelingBdmIndicators = {
  page: 1,
  size: 50,
  total: 100,
  items: [
    {
      id: 'k1',
      code: 'energy.intensity',
      name: '能耗强度',
      unit: 'kWh/t',
      sources: [
        {
          source_type: 'unitProperty',
          source_id: 'energy',
          source_property: null,
          alias: '电量',
          unit: 'kWh',
          is_selectable: true,
        },
        {
          source_type: 'modelOutput',
          source_id: 'prediction',
          source_property: null,
          alias: '预测',
          unit: null,
          is_selectable: false,
        },
      ],
    },
  ],
}
beforeEach(() => {
  vi.spyOn(api, 'getModelingBdmCapabilities').mockResolvedValue(capabilities)
  vi.spyOn(api, 'listModelingBdmCatalog').mockImplementation((query) =>
    Promise.resolve({
      kind: query.kind,
      page: query.page,
      size: 50,
      total: 0,
      items: [],
      system_filter_available: null,
    }),
  )
  vi.spyOn(api, 'listModelingBdmSystems').mockResolvedValue({
    items: [],
    system_filter_available: false,
  })
  vi.spyOn(api, 'listModelingBdmIndicators').mockResolvedValue(indicatorPage)
})
afterEach(() => vi.restoreAllMocks())

function form(config: Record<string, unknown>, isReadonly = false) {
  return mount(BdmSourceConfigForm, {
    props: {
      fields,
      options,
      config: { identifiers: ['p1'], ...config },
      isReadonly,
    },
  })
}

describe('能管配置分区', () => {
  it('从指标导入属性经过完整表单写入标识，并可清空', async () => {
    const wrapper = form({ kind: 'raw', identifiers: [] })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '从指标绑定选择属性')
      ?.trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '添加属性')
      ?.trigger('click')
    expect(wrapper.emitted('change')?.at(-1)).toEqual([
      'identifiers',
      ['energy'],
    ])
    await wrapper.setProps({ config: { kind: 'raw', identifiers: ['energy'] } })
    expect(wrapper.get('[aria-label="已选数据"]').text()).toContain(
      '能耗强度 · 电量',
    )
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '清空选择')
      ?.trigger('click')
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['identifiers', []])
    wrapper.unmount()
  })

  it('公式粒度、严格边界及两个时刻的修改均传到节点配置', async () => {
    const wrapper = form({ kind: 'formula', granularity: 'hour' })
    await flushPromises()
    wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '公式粒度')
      ?.vm.$emit('update:modelValue', 'minute')
    wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '周期边界')
      ?.vm.$emit('update:modelValue', 'strict')
    wrapper
      .findAllComponents(MomentInput)[0]
      ?.vm.$emit('update:modelValue', '-12h')
    wrapper
      .findAllComponents(MomentInput)[1]
      ?.vm.$emit('update:modelValue', '-1h')
    expect(wrapper.emitted('change')).toEqual([
      ['granularity', 'minute'],
      ['time_alignment', 'strict'],
      ['since', '-12h'],
      ['until', '-1h'],
    ])
    wrapper.unmount()
  })

  it('点位与属性隐藏公式参数，展示业务时区和输出口径', async () => {
    const wrapper = form({ kind: 'point' })
    await flushPromises()
    expect(wrapper.text()).toContain('Asia/Shanghai')
    expect(wrapper.text()).toContain('1 · 选择数据')
    expect(wrapper.text()).toContain('3 · 输出设置')
    expect(
      wrapper
        .findAllComponents(DtSelect)
        .some((item) => item.props('label') === '公式粒度'),
    ).toBe(false)
    expect(wrapper.findAllComponents(MomentInput)[0]?.props('allowBlank')).toBe(
      false,
    )
    expect(wrapper.findAllComponents(MomentInput)[1]?.props('allowBlank')).toBe(
      true,
    )
    expect(wrapper.text()).toContain('运行时刻')
    expect(wrapper.emitted('status')?.at(-1)).toEqual([
      { message: '', hasDraft: false },
    ])
    wrapper.unmount()
  })

  it('分钟选项保存为整数，切换小时后不展示可变间隔', async () => {
    const wrapper = form({ kind: 'formula', granularity: 'minute' })
    await flushPromises()
    const interval = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '分钟间隔')
    expect(interval?.props('options')).toEqual(
      BDM_MINUTE_INTERVALS.map((value) => ({
        value: String(value),
        label: `${value} 分钟`,
      })),
    )
    interval?.vm.$emit('update:modelValue', '15')
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['interval_minutes', 15])
    await wrapper.setProps({
      config: { kind: 'formula', granularity: 'hour', identifiers: ['F1'] },
    })
    expect(wrapper.text()).toContain('每 60 分钟一条')
    expect(
      wrapper
        .findAllComponents(DtSelect)
        .some((item) => item.props('label') === '分钟间隔'),
    ).toBe(false)
    await wrapper.setProps({
      config: { kind: 'formula', granularity: 'month', identifiers: ['F1'] },
    })
    expect(wrapper.text()).toContain('当前日／月可能尚未结束')
    expect(
      wrapper
        .findAllComponents(DtSelect)
        .some((item) => item.props('label') === '周期边界'),
    ).toBe(false)
    wrapper.unmount()
  })

  it('必填起点和错误时间在运行前提示', async () => {
    const wrapper = form({ since: '' })
    await flushPromises()
    expect(wrapper.emitted('status')?.at(-1)?.[0]).toMatchObject({
      message: expect.stringContaining('起始时刻'),
    })
    await wrapper.setProps({ config: { identifiers: ['p1'], since: 'wrong' } })
    expect(wrapper.text()).toContain('时间请使用日期选择器')
    wrapper.unmount()
  })

  it('未配置连接仍可编辑；能力请求失败可以重试', async () => {
    vi.mocked(api.getModelingBdmCapabilities)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        ...capabilities,
        is_configured: false,
        timezone: null,
      })
    const wrapper = form({ kind: 'raw' })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '重新读取连接配置')
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('能管连接未启用')
    expect(wrapper.text()).toContain('可以先配置算子')
    wrapper.unmount()
  })

  it('关闭会取消能力请求，只读状态不发出参数修改', () => {
    vi.mocked(api.getModelingBdmCapabilities).mockReturnValue(
      new Promise(() => undefined),
    )
    const wrapper = form({ kind: 'formula', granularity: 'minute' }, true)
    wrapper.findAllComponents(DtSelect)[0]?.vm.$emit('update:modelValue', 'raw')
    expect(wrapper.emitted('change')).toBeUndefined()
    const signal = vi.mocked(api.getModelingBdmCapabilities).mock.calls[0]?.[0]
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
  })
})

describe('参数与时间边界', () => {
  it('换类别原子清空标识和间隔，换粒度保留标识', () => {
    const config = {
      kind: 'formula',
      identifiers: ['F1'],
      granularity: 'minute',
      interval_minutes: 15,
      row_limit: 1000,
    }
    expect(changeBdmConfig(config, 'kind', 'raw')).toEqual({
      ...config,
      kind: 'raw',
      identifiers: [],
      interval_minutes: null,
    })
    expect(changeBdmConfig(config, 'granularity', 'day')).toEqual({
      ...config,
      granularity: 'day',
      interval_minutes: null,
    })
    expect(changeBdmConfig(config, 'row_limit', 2000)).toEqual({
      ...config,
      row_limit: 2000,
    })
    expect(changeBdmConfig(config, 'granularity', 'minute')).toEqual(config)
  })
  it.each(['-30m', '-12h', '-7d', '-4w', '-365d'])(
    '支持已约定的相对时间 %s',
    (since) => {
      expect(bdmTimeError({ since })).toBe('')
    },
  )
  it.each(['-1y', '-1mo', '-2s', '2026-10-01', 'invalid'])(
    '错误写法就地反馈 %s',
    (since) => {
      expect(bdmTimeError({ since })).not.toBe('')
    },
  )
  it('绝对时间有时区且起点必须早于终点', () => {
    expect(
      bdmTimeError({
        since: '2020-01-01T00:00:00Z',
        until: '2026-01-01T00:00:00Z',
      }),
    ).toBe('')
    expect(bdmTimeError({ since: '-1h', until: '-2h' })).toContain('早于')
    expect(bdmTimeError({ since: '-1d', until: '-1d' })).toContain('早于')
  })
  it('支持默认一分钟和固定六十分钟；无效或残留间隔必须提示', () => {
    expect(bdmIntervalError({ kind: 'formula', granularity: 'minute' })).toBe(
      '',
    )
    expect(
      bdmIntervalError({
        kind: 'formula',
        granularity: 'hour',
        interval_minutes: 60,
      }),
    ).toBe('')
    expect(
      bdmIntervalError({
        kind: 'formula',
        granularity: 'minute',
        interval_minutes: 7,
      }),
    ).toContain('分钟间隔')
    expect(
      bdmIntervalError({
        kind: 'formula',
        granularity: 'day',
        interval_minutes: 15,
      }),
    ).toContain('清空旧设置')
  })
})

describe('指标来源选择', () => {
  it('指标请求错误显示提示，重试成功后恢复来源列表', async () => {
    vi.mocked(api.listModelingBdmIndicators)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(indicatorPage)
    const wrapper = mount(BdmIndicatorPicker, {
      props: { selected: [], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '重试指标目录')
      ?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('能耗强度')
    expect(wrapper.text()).not.toContain('请求失败')
    wrapper.unmount()
  })
  it('只导入可查询的真实属性，保留来源单位，不使用指标单位', async () => {
    const wrapper = mount(BdmIndicatorPicker, {
      props: { selected: [], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('仅绑定信息，不能直接取历史值')
    const buttons = wrapper
      .findAll('button')
      .filter((item) => item.text() === '添加属性')
    expect(buttons).toHaveLength(1)
    await buttons[0]?.trigger('click')
    expect(wrapper.emitted('select')?.at(-1)?.[0]).toMatchObject({
      identifier: 'energy',
      unit: 'kWh',
      name: '能耗强度 · 电量',
    })
    await wrapper.setProps({ selected: ['energy'] })
    expect(wrapper.text()).toContain('已添加')
    expect(
      wrapper.findAll('button').some((item) => item.text() === '添加属性'),
    ).toBe(false)
    wrapper.unmount()
  })
  it('搜索回到首页，翻页保留已提交的编码，卸载取消请求', async () => {
    const wrapper = mount(BdmIndicatorPicker, {
      props: { selected: [], isReadonly: false },
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '下一页')
      ?.trigger('click')
    await flushPromises()
    await wrapper.get('input').setValue(' energy.intensity ')
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(
      vi.mocked(api.listModelingBdmIndicators).mock.calls.at(-1)?.[0],
    ).toEqual({ page: 1, code: 'energy.intensity' })
    const signal = vi
      .mocked(api.listModelingBdmIndicators)
      .mock.calls.at(-1)?.[1]
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
  })
  it('只读或达到十个属性时禁用添加', async () => {
    const wrapper = mount(BdmIndicatorPicker, {
      props: { selected: [], isReadonly: true },
    })
    await flushPromises()
    const add = () =>
      wrapper.findAll('button').find((item) => item.text() === '添加属性')
    expect(add()?.attributes('disabled')).toBeDefined()
    await wrapper.setProps({
      isReadonly: false,
      selected: Array.from({ length: 10 }, (_, index) => `p${index}`),
    })
    expect(add()?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
