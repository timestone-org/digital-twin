/**
 * @fileoverview 锁住 DtDateTimeInput 的取值口径：对外 UTC RFC3339、对用户本地时。
 * ⚠ 用例把 TZ 钉死——不钉的话，跑用例的机器在哪个时区会决定这份断言的对错，
 * 而这正是这个组件要挡的那类 8 小时偏差。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DtDateTimeInput from '../../src/components/DtDateTimeInput/DtDateTimeInput.vue'

const SHANGHAI = 'Asia/Shanghai' // UTC+8，无夏令时

afterEach(() => {
  vi.unstubAllEnvs()
})

function mountInShanghai(props: Record<string, unknown> = {}) {
  vi.stubEnv('TZ', SHANGHAI)
  return mount(DtDateTimeInput, { props })
}

describe('DtDateTimeInput 取值换算', () => {
  it('UTC 的 modelValue 渲染成本地时', () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    expect(wrapper.find('input').element.value).toBe('2026-08-12T10:55')
  })

  it('用户输入本地时，emit 出去的是 UTC', async () => {
    const wrapper = mountInShanghai()
    await wrapper.find('input').setValue('2026-08-12T10:55')
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-12T02:55:00.000Z'],
    ])
  })

  it('没有取值时输入框是空的', () => {
    const wrapper = mountInShanghai()
    expect(wrapper.find('input').element.value).toBe('')
  })

  it('清空输入框 emit 空串，而不是一个坏时刻', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    await wrapper.find('input').setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('输入不成形状时 emit 空串，不把半成品抛给上层', async () => {
    const wrapper = mountInShanghai()
    await wrapper.find('input').setValue('2026-08-12T10')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('解析不出的 modelValue 渲染成空而不是 Invalid Date', () => {
    const wrapper = mountInShanghai({ modelValue: '不是时刻' })
    expect(wrapper.find('input').element.value).toBe('')
  })

  it('父组件回写新的 UTC 值时显示跟着走', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    await wrapper.setProps({ modelValue: '2026-08-12T03:55:00.000Z' })
    expect(wrapper.find('input').element.value).toBe('2026-08-12T11:55')
  })
})

describe('DtDateTimeInput 上下界', () => {
  it('min 与 max 同样按本地时落到原生属性上', () => {
    const wrapper = mountInShanghai({
      min: '2026-08-12T00:00:00.000Z',
      max: '2026-08-12T12:00:00.000Z',
    })
    const input = wrapper.find('input')
    expect(input.attributes('min')).toBe('2026-08-12T08:00')
    expect(input.attributes('max')).toBe('2026-08-12T20:00')
  })

  it('没给上下界时属性不出现', () => {
    const input = mountInShanghai().find('input')
    expect(input.attributes('min')).toBeUndefined()
    expect(input.attributes('max')).toBeUndefined()
  })

  it('步长固定到分钟：秒不该出现在这个控件里', () => {
    expect(mountInShanghai().find('input').attributes('step')).toBe('60')
  })
})

describe('DtDateTimeInput 表单契约', () => {
  it('label 与输入框通过 id 关联', () => {
    const wrapper = mountInShanghai({ label: '起始时间' })
    const id = wrapper.find('input').attributes('id')
    expect(wrapper.find('label').attributes('for')).toBe(id)
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mountInShanghai({ hint: '按分钟取值' })
    const described = wrapper.find('input').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('按分钟取值')
  })

  it('error 时标 aria-invalid，并用 role=alert 播报', () => {
    const wrapper = mountInShanghai({ error: '起始时间不能晚于结束时间' })
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toBe(
      '起始时间不能晚于结束时间',
    )
    expect(wrapper.find('.dt-datetime').classes()).toContain(
      'dt-datetime--invalid',
    )
  })

  it('required 透到原生属性并标星', () => {
    const wrapper = mountInShanghai({ label: '起始时间', required: true })
    expect(wrapper.find('input').attributes('required')).toBeDefined()
    expect(wrapper.find('.dt-field__required').exists()).toBe(true)
  })

  it('disabled 时禁用且加修饰类', () => {
    const wrapper = mountInShanghai({ disabled: true })
    expect(wrapper.find('input').attributes('disabled')).toBe('')
    expect(wrapper.find('.dt-datetime').classes()).toContain(
      'dt-datetime--disabled',
    )
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mountInShanghai({ size })
    expect(wrapper.find('.dt-datetime').classes()).toContain(
      `dt-datetime--${size}`,
    )
  })

  it('aria-label / name 这类原生属性逐个透传', () => {
    const wrapper = mountInShanghai({
      'aria-label': '起始时间',
      name: 'started_at',
    })
    const input = wrapper.find('input')
    expect(input.attributes('aria-label')).toBe('起始时间')
    expect(input.attributes('name')).toBe('started_at')
  })
})
