/** @fileoverview 信息牌状态显示方式的选择、文案配色与字段写回契约。 */
import type { TwinPanelField, TwinPanelState } from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import PanelFieldGraph from '@/pages/TwinEditor/components/fields/PanelFieldGraph.vue'

const STATE = {
  onValue: '1',
  offValue: '0',
  onLabel: '开启',
  offLabel: '关闭',
  unknownLabel: '未知',
  onTone: 'success',
  offTone: 'neutral',
} as const

function stateWithItems(over: Partial<TwinPanelState> = {}): TwinPanelState {
  const state = { ...STATE, ...over }
  return {
    ...state,
    states: [
      {
        id: 'on',
        value: state.onValue,
        label: state.onLabel,
        tone: state.onTone,
      },
      {
        id: 'off',
        value: state.offValue,
        label: state.offLabel,
        tone: state.offTone,
      },
    ],
  }
}

function field(over: Partial<TwinPanelField> = {}): TwinPanelField {
  return {
    key: 'run',
    label: '运行状态',
    unit: '',
    prefix: '',
    decimals: null,
    staticText: '',
    kind: 'text',
    min: 0,
    max: 100,
    levels: [{ id: 'fault', at: 1, tone: 'danger' }],
    ...over,
  }
}

function render(value: TwinPanelField) {
  return mount(PanelFieldGraph, {
    props: { field: value },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof render>

function latestState(wrapper: Wrapper): TwinPanelState {
  const state = wrapper
    .emitted<[Partial<TwinPanelField>]>('update')
    ?.at(-1)?.[0].state
  if (state === undefined) throw new Error('缺少状态更新')
  return state
}

async function select(
  wrapper: Wrapper,
  label: string,
  optionLabel: string,
): Promise<void> {
  await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent?.trim() === optionLabel,
  )
  if (option === undefined) throw new Error(`缺少选项：${optionLabel}`)
  option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('状态显示方式', () => {
  it.each([
    ['状态徽标', 'status'],
    ['开关指示', 'switch'],
  ] as const)('可选择%s并写入默认映射', async (label, kind) => {
    const wrapper = render(field())

    await select(wrapper, '显示方式', label)

    expect(wrapper.emitted('update')).toEqual([[{ kind, state: STATE }]])
    wrapper.unmount()
  })

  it.each(['status', 'switch'] as const)(
    '%s显示状态映射并隐藏数值阈值',
    (kind) => {
      const wrapper = render(field({ kind, state: { ...STATE } }))

      expect(
        wrapper.get<HTMLInputElement>('input[aria-label="状态1值"]').element
          .value,
      ).toBe('1')
      expect(
        wrapper.get<HTMLInputElement>('input[aria-label="状态2值"]').element
          .value,
      ).toBe('0')
      expect(wrapper.find('input[aria-label="阈值"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('添加阈值档')
      wrapper.unmount()
    },
  )

  it('非状态显示方式没有无效的状态配置', () => {
    const wrapper = render(field())

    expect(wrapper.find('input[aria-label="状态1值"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('添加阈值档')
    wrapper.unmount()
  })

  it('状态显示方式之间切换保留自定义映射', async () => {
    const state = { ...STATE, onValue: 'running', onLabel: '运行' }
    const wrapper = render(field({ kind: 'status', state }))

    await select(wrapper, '显示方式', '开关指示')

    expect(wrapper.emitted('update')).toEqual([[{ kind: 'switch' }]])
    expect(state.onLabel).toBe('运行')
    wrapper.unmount()
  })
})

describe('状态配置', () => {
  it('可添加第三个状态、编辑其值文案颜色并删除中间状态', async () => {
    const original = field({ kind: 'status', state: { ...STATE } })
    const wrapper = render(original)

    await wrapper.get('button[aria-label="添加状态"]').trigger('click')
    const added = latestState(wrapper)
    expect(added.states).toHaveLength(3)
    const thirdId = added.states?.[2]?.id
    expect(thirdId).toBeTruthy()
    expect(added.states?.[2]?.value).toBe('')
    await wrapper.setProps({ field: { ...original, state: added } })

    await wrapper.get('input[aria-label="状态3值"]').setValue('2')
    await wrapper.setProps({
      field: { ...original, state: latestState(wrapper) },
    })
    await wrapper.get('input[aria-label="状态3文案"]').setValue('故障')
    await wrapper.setProps({
      field: { ...original, state: latestState(wrapper) },
    })
    await select(wrapper, '状态3颜色', '红色')
    const edited = latestState(wrapper)
    expect(edited.states?.[2]).toEqual({
      id: thirdId,
      value: '2',
      label: '故障',
      tone: 'danger',
    })
    await wrapper.setProps({ field: { ...original, state: edited } })

    await wrapper.get('button[aria-label="删除状态2"]').trigger('click')
    const removed = latestState(wrapper)
    expect(removed.states?.map((item) => item.id)).toEqual(['on', thirdId])
    await wrapper.setProps({ field: { ...original, state: removed } })
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="状态2文案"]').element
        .value,
    ).toBe('故障')
    expect(original.state).toEqual(STATE)
    wrapper.unmount()
  })

  it('缺少映射配置的状态字段可直接编辑默认值', async () => {
    const wrapper = render(field({ kind: 'switch' }))

    await wrapper.get('input[aria-label="状态1文案"]').setValue('供电')

    expect(wrapper.emitted('update')).toEqual([
      [{ state: stateWithItems({ onLabel: '供电' }) }],
    ])
    wrapper.unmount()
  })

  it.each([
    ['状态1值', 'onValue', 'running'],
    ['状态2值', 'offValue', 'stopped'],
    ['状态1文案', 'onLabel', '运行中'],
    ['状态2文案', 'offLabel', '已停机'],
    ['未知文案', 'unknownLabel', '待确认'],
  ] as const)('%s写回整份映射并保留其他配置', async (label, key, value) => {
    const original = field({ kind: 'status', state: { ...STATE } })
    const wrapper = render(original)

    await wrapper.get(`input[aria-label="${label}"]`).setValue(value)

    expect(wrapper.emitted('update')).toEqual([
      [{ state: stateWithItems({ [key]: value }) }],
    ])
    expect(original.state).toEqual(STATE)
    wrapper.unmount()
  })

  it.each([
    ['状态1颜色', 'onTone', '红色', 'danger'],
    ['状态2颜色', 'offTone', '绿色', 'success'],
  ] as const)('%s通过实际下拉交互写回', async (label, key, name, value) => {
    const wrapper = render(field({ kind: 'switch', state: { ...STATE } }))

    await select(wrapper, label, name)

    expect(wrapper.emitted('update')).toEqual([
      [{ state: stateWithItems({ [key]: value }) }],
    ])
    wrapper.unmount()
  })

  it.each(['1', '', 'true', '1.00'])(
    '关闭值为%s导致空编码或状态重合时明确提示',
    (offValue) => {
      const wrapper = render(
        field({ kind: 'status', state: { ...STATE, offValue } }),
      )

      expect(wrapper.text()).toContain('状态值为空或重复')
      wrapper.unmount()
    },
  )

  it('编辑未知文案保留所有自定义状态以及未出现在列表中的旧字段', async () => {
    const state: TwinPanelState = {
      ...STATE,
      states: [
        { id: 'idle', value: '0', label: '停机', tone: 'neutral' },
        { id: 'run', value: '1', label: '运行', tone: 'success' },
        { id: 'fault', value: '2', label: '故障', tone: 'danger' },
      ],
    }
    const wrapper = render(field({ kind: 'status', state }))

    await wrapper.get('input[aria-label="未知文案"]').setValue('待确认')

    expect(latestState(wrapper)).toEqual({ ...state, unknownLabel: '待确认' })
    expect(state.unknownLabel).toBe('未知')
    wrapper.unmount()
  })

  it('已保存状态列表优先于旧字段，编辑时同步开启关闭兼容字段', async () => {
    const state: TwinPanelState = {
      ...STATE,
      states: [
        { id: 'on', value: 'run', label: '运行', tone: 'accent' },
        { id: 'off', value: 'stop', label: '停机', tone: 'warning' },
        { id: 'fault', value: 'fault', label: '故障', tone: 'danger' },
      ],
    }
    const wrapper = render(field({ kind: 'switch', state }))

    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="状态1值"]').element
        .value,
    ).toBe('run')
    await wrapper.get('input[aria-label="状态2文案"]').setValue('已停机')

    expect(latestState(wrapper)).toEqual({
      onValue: 'run',
      onLabel: '运行',
      onTone: 'accent',
      offValue: 'stop',
      offLabel: '已停机',
      offTone: 'warning',
      unknownLabel: '未知',
      states: [
        { id: 'on', value: 'run', label: '运行', tone: 'accent' },
        { id: 'off', value: 'stop', label: '已停机', tone: 'warning' },
        { id: 'fault', value: 'fault', label: '故障', tone: 'danger' },
      ],
    })
    expect(state.offLabel).toBe('关闭')
    wrapper.unmount()
  })

  it.each(['', '2.00', ' 2 '])(
    '第三状态的%s为空或与另一状态编码规范化重复时明确提示',
    (value) => {
      const state: TwinPanelState = {
        ...STATE,
        states: [
          { id: 'run', value: '1', label: '运行', tone: 'success' },
          { id: 'fault', value: '2', label: '故障', tone: 'danger' },
          { id: 'other', value, label: '其他', tone: 'neutral' },
        ],
      }
      const wrapper = render(field({ kind: 'status', state }))

      expect(wrapper.text()).toContain('状态值为空或重复')
      wrapper.unmount()
    },
  )

  it('显式空列表保留空态，编辑未知文案不会重新添加开启关闭状态', async () => {
    const state: TwinPanelState = { ...STATE, states: [] }
    const wrapper = render(field({ kind: 'status', state }))

    expect(wrapper.find('input[aria-label="状态1值"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('至少添加一个状态')
    await wrapper.get('input[aria-label="未知文案"]').setValue('未配置')
    expect(latestState(wrapper)).toEqual({ ...state, unknownLabel: '未配置' })
    await wrapper.setProps({
      field: field({ kind: 'status', state: latestState(wrapper) }),
    })
    await wrapper.get('button[aria-label="添加状态"]').trigger('click')
    expect(latestState(wrapper).states).toEqual([
      { id: 'state-1', value: '', label: '状态1', tone: 'neutral' },
    ])
    wrapper.unmount()
  })

  it('可删除所有状态并保持显式空列表', async () => {
    const wrapper = render(field({ kind: 'switch', state: { ...STATE } }))

    await wrapper.get('button[aria-label="删除状态1"]').trigger('click')
    await wrapper.setProps({
      field: field({ kind: 'switch', state: latestState(wrapper) }),
    })
    expect(latestState(wrapper).states?.map((item) => item.id)).toEqual(['off'])
    await wrapper.get('button[aria-label="删除状态1"]').trigger('click')
    expect(latestState(wrapper).states).toEqual([])
    await wrapper.setProps({
      field: field({ kind: 'switch', state: latestState(wrapper) }),
    })
    expect(wrapper.text()).toContain('至少添加一个状态')
    expect(wrapper.find('input[aria-label="状态1值"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('添加状态的标识不会与现有状态重复', async () => {
    const state: TwinPanelState = {
      ...STATE,
      states: [{ id: 'state-2', value: '2', label: '故障', tone: 'danger' }],
    }
    const wrapper = render(field({ kind: 'status', state }))

    await wrapper.get('button[aria-label="添加状态"]').trigger('click')

    expect(latestState(wrapper).states?.map((item) => item.id)).toEqual([
      'state-2',
      'state-3',
    ])
    wrapper.unmount()
  })
})
