/** @fileoverview 信息牌状态画法的选择、文案配色与字段写回契约。 */
import type { TwinPanelField } from '@dt/twin-config'
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

describe('状态画法', () => {
  it.each([
    ['状态徽标', 'status'],
    ['开关指示', 'switch'],
  ] as const)('可选择%s并写入默认映射', async (label, kind) => {
    const wrapper = render(field())

    await select(wrapper, '画法', label)

    expect(wrapper.emitted('update')).toEqual([[{ kind, state: STATE }]])
    wrapper.unmount()
  })

  it.each(['status', 'switch'] as const)(
    '%s显示状态映射并隐藏数值阈值',
    (kind) => {
      const wrapper = render(field({ kind, state: { ...STATE } }))

      expect(
        wrapper.get<HTMLInputElement>('input[aria-label="开启值"]').element
          .value,
      ).toBe('1')
      expect(
        wrapper.get<HTMLInputElement>('input[aria-label="关闭值"]').element
          .value,
      ).toBe('0')
      expect(wrapper.find('input[aria-label="阈值"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('添加阈值档')
      wrapper.unmount()
    },
  )

  it('非状态画法没有无效的状态配置', () => {
    const wrapper = render(field())

    expect(wrapper.find('input[aria-label="开启值"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('添加阈值档')
    wrapper.unmount()
  })

  it('状态画法之间切换保留自定义映射', async () => {
    const state = { ...STATE, onValue: 'running', onLabel: '运行' }
    const wrapper = render(field({ kind: 'status', state }))

    await select(wrapper, '画法', '开关指示')

    expect(wrapper.emitted('update')).toEqual([[{ kind: 'switch' }]])
    expect(state.onLabel).toBe('运行')
    wrapper.unmount()
  })
})

describe('状态配置', () => {
  it('缺少映射配置的状态字段可直接编辑默认值', async () => {
    const wrapper = render(field({ kind: 'switch' }))

    await wrapper.get('input[aria-label="开启文案"]').setValue('供电')

    expect(wrapper.emitted('update')).toEqual([
      [{ state: { ...STATE, onLabel: '供电' } }],
    ])
    wrapper.unmount()
  })

  it.each([
    ['开启值', 'onValue', 'running'],
    ['关闭值', 'offValue', 'stopped'],
    ['开启文案', 'onLabel', '运行中'],
    ['关闭文案', 'offLabel', '已停机'],
    ['未知文案', 'unknownLabel', '待确认'],
  ] as const)('%s写回整份映射并保留其他配置', async (label, key, value) => {
    const original = field({ kind: 'status', state: { ...STATE } })
    const wrapper = render(original)

    await wrapper.get(`input[aria-label="${label}"]`).setValue(value)

    expect(wrapper.emitted('update')).toEqual([
      [{ state: { ...STATE, [key]: value } }],
    ])
    expect(original.state).toEqual(STATE)
    wrapper.unmount()
  })

  it.each([
    ['开启颜色', 'onTone', '红色', 'danger'],
    ['关闭颜色', 'offTone', '绿色', 'success'],
  ] as const)('%s通过实际下拉交互写回', async (label, key, name, value) => {
    const wrapper = render(field({ kind: 'switch', state: { ...STATE } }))

    await select(wrapper, label, name)

    expect(wrapper.emitted('update')).toEqual([
      [{ state: { ...STATE, [key]: value } }],
    ])
    wrapper.unmount()
  })

  it.each(['1', '', 'true', '1.00'])(
    '关闭值为%s导致空编码或状态重合时明确提示',
    (offValue) => {
      const wrapper = render(
        field({ kind: 'status', state: { ...STATE, offValue } }),
      )

      expect(wrapper.text()).toContain('开启值与关闭值相同')
      wrapper.unmount()
    },
  )
})
