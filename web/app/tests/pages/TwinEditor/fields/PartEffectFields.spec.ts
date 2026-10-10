/** @fileoverview 状态效果通过真实控件整份写回，暂停和模式切换保留配置。 */
import {
  DEFAULT_PART_EFFECT,
  normalizePartEffect,
  type TwinPartEffect,
} from '@dt/twin-config'
import { DtColorInput } from '@dt/ui'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import PartEffectFields from '@/pages/TwinEditor/components/fields/PartEffectFields.vue'

enableAutoUnmount(afterEach)

function mountFields(
  modelValue: TwinPartEffect | null = { ...DEFAULT_PART_EFFECT },
  bound = true,
) {
  return mount(PartEffectFields, {
    props: { modelValue, bound },
    global: { stubs: { teleport: true } },
  })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): TwinPartEffect {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回效果')
  const value = normalizePartEffect(events[events.length - 1]?.[0])
  if (value === null) throw new Error('写回丢失状态效果')
  return value
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

describe('启用和暂停', () => {
  it('首次启用预置开关量等于1的柔和呼吸', async () => {
    const wrapper = mountFields(null)

    await wrapper.get('button[aria-label="启用状态效果"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual({
      enabled: true,
      mode: 'point',
      operator: 'eq',
      threshold: 1,
      pattern: 'pulse',
      color: '--state-warning',
      blend: 0.85,
      glow: 1.2,
      periodMs: 1600,
    })
  })

  it('暂停后原规则保留，重新开启恢复原外观和触发条件', async () => {
    const original: TwinPartEffect = {
      ...DEFAULT_PART_EFFECT,
      operator: 'gte',
      threshold: 60,
      pattern: 'blink',
      color: '--state-danger',
      periodMs: 2400,
    }
    const wrapper = mountFields(original)

    await wrapper.get('button[aria-label="启用状态效果"]').trigger('click')
    expect(lastWrite(wrapper)).toEqual({ ...original, enabled: false })
    await wrapper.setProps({ modelValue: lastWrite(wrapper) })
    expect(wrapper.text()).toContain('原配置和点位保留')
    expect(wrapper.find('[aria-label="效果触发值"]').exists()).toBe(false)

    await wrapper.get('button[aria-label="启用状态效果"]').trigger('click')
    expect(lastWrite(wrapper)).toEqual(original)
  })

  it('未启用时不显示点位警告和配置控件', () => {
    const wrapper = mountFields(null, false)

    expect(wrapper.text()).toContain('关联一个开关量点位')
    expect(wrapper.text()).not.toContain('尚未绑定状态点位')
    expect(wrapper.find('[aria-label="效果触发方式"]').exists()).toBe(false)
  })
})

describe('触发方式和条件', () => {
  it('点位未配置时说明选择和保存入口', () => {
    const wrapper = mountFields({ ...DEFAULT_PART_EFFECT }, false)

    expect(wrapper.text()).toContain('尚未绑定状态点位')
    expect(wrapper.text()).toContain('保存后开始接收实时数据')
  })

  it('已绑定点位时不提示缺少点位，并说明开关量与无数据行为', () => {
    const wrapper = mountFields()

    expect(wrapper.text()).not.toContain('尚未绑定状态点位')
    expect(wrapper.text()).toContain('开启 = 1，关闭 = 0')
    expect(wrapper.text()).toContain('无有效数据时恢复正常外观')
  })

  it('切换始终触发和点位控制只修改mode，保留条件', async () => {
    const original: TwinPartEffect = {
      ...DEFAULT_PART_EFFECT,
      operator: 'lt',
      threshold: 12,
    }
    const wrapper = mountFields(original, false)

    await buttonByText(wrapper, '始终触发').trigger('click')
    expect(lastWrite(wrapper)).toEqual({ ...original, mode: 'always' })
    await wrapper.setProps({ modelValue: lastWrite(wrapper) })
    expect(wrapper.text()).not.toContain('尚未绑定状态点位')
    expect(wrapper.text()).toContain('原点位和触发条件保留')
    expect(wrapper.find('[aria-label="效果触发值"]').exists()).toBe(false)

    await buttonByText(wrapper, '点位控制').trigger('click')
    expect(lastWrite(wrapper)).toEqual(original)
  })

  it.each([
    ['等于', 'eq'],
    ['不等于', 'neq'],
    ['大于', 'gt'],
    ['大于等于', 'gte'],
    ['小于', 'lt'],
    ['小于等于', 'lte'],
  ] as const)('在真实菜单选择%s整份写回运算符', async (label, operator) => {
    const wrapper = mountFields()
    await wrapper.get('button[aria-label="效果触发条件"]').trigger('click')
    const option = wrapper
      .findAll('[role="option"]')
      .find((item) => item.text() === label)
    if (!option) throw new Error(`菜单缺少 ${label}`)

    await option.trigger('click')

    expect(lastWrite(wrapper)).toMatchObject({ operator, threshold: 1 })
  })

  it('输入0可配置关闭状态触发，清空时恢复默认1', async () => {
    const wrapper = mountFields()

    await wrapper.get('input[aria-label="效果触发值"]').setValue('0')
    expect(lastWrite(wrapper).threshold).toBe(0)

    await wrapper.get('input[aria-label="效果触发值"]').setValue('')
    expect(lastWrite(wrapper).threshold).toBe(1)
  })
})

describe('外观和周期', () => {
  it.each([
    ['运行常亮', 'steady', '--state-success'],
    ['故障闪烁', 'blink', '--state-danger'],
    ['提醒呼吸', 'pulse', '--state-warning'],
  ] as const)(
    '应用%s仅改外观，不覆盖点位触发条件',
    async (label, pattern, color) => {
      const wrapper = mountFields({
        ...DEFAULT_PART_EFFECT,
        mode: 'always',
        operator: 'neq',
        threshold: 5,
      })

      await buttonByText(wrapper, label).trigger('click')

      expect(lastWrite(wrapper)).toMatchObject({
        enabled: true,
        mode: 'always',
        operator: 'neq',
        threshold: 5,
        pattern,
        color,
      })
    },
  )

  it.each([
    ['持续高亮', 'steady'],
    ['柔和呼吸', 'pulse'],
    ['明显闪烁', 'blink'],
  ] as const)('选择%s保留颜色和周期', async (label, pattern) => {
    const wrapper = mountFields({ ...DEFAULT_PART_EFFECT, periodMs: 2800 })

    await buttonByText(wrapper, label).trigger('click')

    expect(lastWrite(wrapper)).toMatchObject({
      pattern,
      periodMs: 2800,
      color: '--state-warning',
    })
  })

  it('持续高亮没有周期控件，切换显示方式保留原周期', () => {
    const wrapper = mountFields({ ...DEFAULT_PART_EFFECT, pattern: 'steady' })

    expect(wrapper.find('[aria-label="效果变化周期"]').exists()).toBe(false)
  })

  it('秒输入准确写回毫秒，清空恢复默认周期', async () => {
    const wrapper = mountFields()
    expect(
      wrapper.get('input[aria-label="效果变化周期"]').element,
    ).toHaveProperty('value', '1.6')

    await wrapper.get('input[aria-label="效果变化周期"]').setValue('2.3')
    expect(lastWrite(wrapper).periodMs).toBe(2300)
    await wrapper.get('input[aria-label="效果变化周期"]').setValue('')
    expect(lastWrite(wrapper).periodMs).toBe(1600)
  })

  it.each([
    ['0.1', 600],
    ['12', 10000],
  ])('周期输入%s秒被限制在支持范围', async (seconds, periodMs) => {
    const wrapper = mountFields()

    await wrapper.get('input[aria-label="效果变化周期"]').setValue(seconds)

    expect(lastWrite(wrapper).periodMs).toBe(periodMs)
  })

  it('清空颜色仍可配置高亮，0浓度有效且保留发光设置', async () => {
    const wrapper = mountFields()
    await wrapper
      .getComponent(DtColorInput)
      .get('input[type="text"]')
      .setValue('')
    expect(lastWrite(wrapper).color).toBe('')
    await wrapper.setProps({ modelValue: lastWrite(wrapper) })

    await wrapper.get('input[aria-label="效果变色浓度"]').setValue('0')
    expect(lastWrite(wrapper)).toMatchObject({ color: '', blend: 0, glow: 1.2 })
    await wrapper.get('input[aria-label="效果高亮强度"]').setValue('2')
    expect(lastWrite(wrapper)).toMatchObject({ color: '', glow: 2 })
  })

  it('从真实语义色板选颜色只改效果颜色', async () => {
    const wrapper = mountFields()

    await wrapper.get('button[aria-label="--state-danger"]').trigger('click')

    expect(lastWrite(wrapper)).toMatchObject({
      color: '--state-danger',
      threshold: 1,
      pattern: 'pulse',
    })
  })

  it('说明叠加顺序和对点击动画的兼容行为', () => {
    const wrapper = mountFields()

    expect(wrapper.text()).toContain('常态外观 → 状态染色 → 状态效果')
    expect(wrapper.text()).toContain('不影响点击和模型动画')
  })
})
