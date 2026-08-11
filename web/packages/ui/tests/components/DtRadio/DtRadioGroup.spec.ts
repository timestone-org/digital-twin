/**
 * @fileoverview DtRadioGroup 的编排契约：roving tabindex、方向键环绕、跳过禁用项。
 * ⚠ roving 写错时表现是「整组 Tab 不进去」或「Tab 要按 N 下才能跳过一组单选」，
 * 两者在鼠标下都完全看不出来。
 */
import type { DtRadioOption } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtRadioGroup from '../../../src/components/DtRadio/DtRadioGroup.vue'

const DAY: DtRadioOption = { value: 'day', label: '按天' }
const WEEK: DtRadioOption = { value: 'week', label: '按周' }
const MONTH: DtRadioOption = { value: 'month', label: '按月' }
const OPTIONS: DtRadioOption[] = [DAY, WEEK, MONTH]

type GroupProps = InstanceType<typeof DtRadioGroup>['$props']

function mountGroup(props: Partial<GroupProps> = {}) {
  return mount(DtRadioGroup, {
    props: { modelValue: 'day', options: OPTIONS, ...props },
    attachTo: document.body,
  })
}

function tabindexes(wrapper: ReturnType<typeof mountGroup>): string[] {
  return wrapper
    .findAll('[role="radio"]')
    .map((radio) => radio.attributes('tabindex') ?? '')
}

describe('DtRadioGroup 渲染', () => {
  it('以 role=radiogroup 承载语义', () => {
    const wrapper = mountGroup()
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('每个选项渲染一个 radio', () => {
    const wrapper = mountGroup()
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(3)
    wrapper.unmount()
  })

  it('选中项由 modelValue 决定', () => {
    const wrapper = mountGroup({ modelValue: 'week' })
    const checked = wrapper
      .findAll('[role="radio"]')
      .map((radio) => radio.attributes('aria-checked'))
    expect(checked).toEqual(['false', 'true', 'false'])
    wrapper.unmount()
  })

  it('空选项列表不渲染任何 radio', () => {
    const wrapper = mountGroup({ options: [] })
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('可见 label 同时成为整组的可访问名称', () => {
    const wrapper = mountGroup({ label: '统计周期' })
    expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe(
      '统计周期',
    )
    wrapper.unmount()
  })

  it('ariaLabel 优先于 label，供宿主自己画标题时用', () => {
    const wrapper = mountGroup({ label: '统计周期', ariaLabel: '周期' })
    expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe(
      '周期',
    )
    wrapper.unmount()
  })

  it('hint 经 aria-describedby 关联到整组', () => {
    const wrapper = mountGroup({ hint: '按天最细' })
    const described = wrapper
      .find('[role="radiogroup"]')
      .attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('按天最细')
    wrapper.unmount()
  })

  it('error 时标 aria-invalid 并用 role=alert 播报', () => {
    const wrapper = mountGroup({ error: '请选择周期' })
    expect(wrapper.find('[role="radiogroup"]').attributes('aria-invalid')).toBe(
      'true',
    )
    expect(wrapper.find('[role="alert"]').text()).toBe('请选择周期')
    wrapper.unmount()
  })

  it.each(['vertical', 'horizontal'] as const)(
    'orientation=%s 同时落到类与 aria-orientation',
    (orientation) => {
      const wrapper = mountGroup({ orientation })
      const group = wrapper.find('[role="radiogroup"]')
      expect(group.classes()).toContain(`dt-radio-group--${orientation}`)
      expect(group.attributes('aria-orientation')).toBe(orientation)
      wrapper.unmount()
    },
  )
})

describe('DtRadioGroup roving tabindex', () => {
  it('只有选中项可 Tab 进入', () => {
    const wrapper = mountGroup({ modelValue: 'week' })
    expect(tabindexes(wrapper)).toEqual(['-1', '0', '-1'])
    wrapper.unmount()
  })

  it('无选中时首个可用项接管 Tab 序', () => {
    const wrapper = mountGroup({ modelValue: '' })
    expect(tabindexes(wrapper)).toEqual(['0', '-1', '-1'])
    wrapper.unmount()
  })

  it('无选中且首项禁用时，Tab 序落到第一个可用项', () => {
    const wrapper = mountGroup({
      modelValue: '',
      options: [{ ...DAY, disabled: true }, WEEK, MONTH],
    })
    expect(tabindexes(wrapper)).toEqual(['-1', '0', '-1'])
    wrapper.unmount()
  })

  it('整组禁用时没有任何项能 Tab 进入', () => {
    const wrapper = mountGroup({ disabled: true })
    expect(tabindexes(wrapper)).toEqual(['-1', '-1', '-1'])
    wrapper.unmount()
  })
})

describe('DtRadioGroup 选择', () => {
  it('点击选项 emit 它的 value', async () => {
    const wrapper = mountGroup()
    await wrapper.findAll('[role="radio"]')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['week']])
    wrapper.unmount()
  })

  it('点击已选中的项不再 emit', async () => {
    const wrapper = mountGroup()
    await wrapper.findAll('[role="radio"]')[0]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('禁用的单项点不动', async () => {
    const wrapper = mountGroup({
      options: [DAY, { ...WEEK, disabled: true }, MONTH],
    })
    await wrapper.findAll('[role="radio"]')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('整组禁用时每一项都点不动', async () => {
    const wrapper = mountGroup({ disabled: true })
    await wrapper.findAll('[role="radio"]')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('DtRadioGroup 方向键', () => {
  it.each(['ArrowDown', 'ArrowRight'])('%s 选中下一项', async (key) => {
    const wrapper = mountGroup()
    await wrapper.find('[role="radiogroup"]').trigger('keydown', { key })
    expect(wrapper.emitted('update:modelValue')).toEqual([['week']])
    wrapper.unmount()
  })

  it.each(['ArrowUp', 'ArrowLeft'])('%s 从首项环绕到末项', async (key) => {
    const wrapper = mountGroup()
    await wrapper.find('[role="radiogroup"]').trigger('keydown', { key })
    expect(wrapper.emitted('update:modelValue')).toEqual([['month']])
    wrapper.unmount()
  })

  it('末项按下行键环绕回首项', async () => {
    const wrapper = mountGroup({ modelValue: 'month' })
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['day']])
    wrapper.unmount()
  })

  it('跳过禁用项', async () => {
    const wrapper = mountGroup({
      options: [DAY, { ...WEEK, disabled: true }, MONTH],
    })
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['month']])
    wrapper.unmount()
  })

  it('空选项组按方向键不抛错', async () => {
    const wrapper = mountGroup({ options: [] })
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('全部禁用时方向键不 emit 也不抛错', async () => {
    const wrapper = mountGroup({ disabled: true })
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('选中后焦点跟到新的一项', async () => {
    const wrapper = mountGroup()
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(
      wrapper.findAll('[role="radio"]')[1]?.element,
    )
    wrapper.unmount()
  })

  it('起点取当前焦点，而不是父组件尚未回写的 modelValue', async () => {
    const wrapper = mountGroup()
    const radios = wrapper.findAll('[role="radio"]')
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    // 父组件没回写 modelValue，仍停在 day；再按一次必须从焦点所在的 week 起算
    await wrapper
      .find('[role="radiogroup"]')
      .trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['week'], ['month']])
    expect(document.activeElement).toBe(radios[2]?.element)
    wrapper.unmount()
  })

  it('非方向键不拦截、不选择', async () => {
    const wrapper = mountGroup()
    await wrapper.find('[role="radiogroup"]').trigger('keydown', { key: 'Tab' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})
