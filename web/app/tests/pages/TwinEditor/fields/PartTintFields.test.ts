/**
 * @fileoverview 契约：部件的状态染色面板把「档位顺序就是优先级」「区间上界不含」
 * 「没绑点位就只会是回落色」这三件事摆在用户眼前，并整份写回规则。
 *
 * ⚠ 开关一关这个部件就不再占绑定行，已经绑上的点位会跟着丢——面板上必须说，
 * 否则用户关一下再打开，发现点位没了却找不到原因。
 */
import { normalizePartTint, type TwinPartTint } from '@dt/twin-config'
import { DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PartTintFields from '@/pages/TwinEditor/components/fields/PartTintFields.vue'
import TintStopRow from '@/pages/TwinEditor/components/fields/TintStopRow.vue'

function rule(over: Record<string, unknown> = {}): TwinPartTint {
  const built = normalizePartTint(over)
  if (built === null) throw new Error('造不出染色规则')
  return built
}

const TWO_STOPS = rule({
  stops: [
    {
      id: 'a',
      match: 'range',
      from: 0,
      to: 60,
      color: '#00ff00',
      label: '正常',
    },
    { id: 'b', match: 'range', from: 60, color: '#ff0000', label: '偏高' },
  ],
})

function mountFields(modelValue: TwinPartTint | null, bound = true) {
  return mount(PartTintFields, { props: { modelValue, bound } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): TwinPartTint | null {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回规则')
  const [next] = events[events.length - 1] ?? []
  return (next ?? null) as TwinPartTint | null
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

describe('开关', () => {
  it('关着时不显示任何档位，只说清它不取数', () => {
    const wrapper = mountFields(null)

    expect(wrapper.text()).toContain('不取数')
    expect(wrapper.findAll('[aria-label="命中方式"]')).toHaveLength(0)
  })

  // 开了却什么都没有会让人以为开关没生效
  it('打开时预置两档，不是一张空表', async () => {
    const wrapper = mountFields(null)

    wrapper.findComponent(DtSwitch).vm.$emit('update:modelValue', true)
    await wrapper.vm.$nextTick()

    expect(lastWrite(wrapper)?.stops).toHaveLength(2)
  })

  it('关掉时整条写回 null', async () => {
    const wrapper = mountFields(TWO_STOPS)

    wrapper.findComponent(DtSwitch).vm.$emit('update:modelValue', false)
    await wrapper.vm.$nextTick()

    expect(lastWrite(wrapper)).toBeNull()
  })
})

describe('没绑点位时的提醒', () => {
  // ⚠ 不提醒的话，用户配好一堆档位看到的是「颜色一动不动」，与点位没通一模一样
  it('还没挑点位时当场说出来', () => {
    expect(mountFields(TWO_STOPS, false).text()).toContain('还没挑点位')
  })

  it('挑过了就不再提醒', () => {
    expect(mountFields(TWO_STOPS, true).text()).not.toContain('还没挑点位')
  })
})

describe('档位表', () => {
  it('一档都没有时说清它只会是回落色', () => {
    const wrapper = mountFields(rule({ stops: [] }))

    expect(wrapper.text()).toContain('回落色')
    expect(wrapper.text()).toContain('一档都没配')
  })

  it('添加一档追加到末尾，且 id 不与现有的重名', async () => {
    const wrapper = mountFields(TWO_STOPS)

    await buttonByText(wrapper, '添加一档').trigger('click')

    const stops = lastWrite(wrapper)?.stops ?? []
    expect(stops).toHaveLength(3)
    expect(new Set(stops.map((stop) => stop.id)).size).toBe(3)
  })

  it('删掉一档只删它自己', async () => {
    const wrapper = mountFields(TWO_STOPS)

    await wrapper.findAll('button[aria-label="删除档位"]')[0]?.trigger('click')

    expect(lastWrite(wrapper)?.stops.map((stop) => stop.id)).toEqual(['b'])
  })

  // ⚠ 顺序就是优先级：区间重叠时靠它定胜负，所以必须能调
  it('上移一档换到前面去', async () => {
    const wrapper = mountFields(TWO_STOPS)

    await wrapper.findAll('button[aria-label="上移档位"]')[1]?.trigger('click')

    expect(lastWrite(wrapper)?.stops.map((stop) => stop.id)).toEqual(['b', 'a'])
  })

  it('第一档不能再上移，最后一档不能再下移', () => {
    const wrapper = mountFields(TWO_STOPS)
    const up = wrapper.findAll('button[aria-label="上移档位"]')
    const down = wrapper.findAll('button[aria-label="下移档位"]')

    expect(up[0]?.attributes('disabled')).toBeDefined()
    expect(down[1]?.attributes('disabled')).toBeDefined()
  })

  it('把顺序与含不含边界写在面板上', () => {
    const wrapper = mountFields(TWO_STOPS)

    expect(wrapper.text()).toContain('自上而下取第一个命中的档')
    expect(wrapper.text()).toContain('下界含、上界不含')
  })
})

describe('渐变', () => {
  it('切到渐变时摆出区间与两端色，不再摆档位表', () => {
    const wrapper = mountFields(rule({ mode: 'gradient' }))

    expect(wrapper.text()).toContain('区间下端')
    expect(wrapper.findAll('button[aria-label="删除档位"]')).toHaveLength(0)
  })

  it('改区间上端只动那一项', async () => {
    const wrapper = mountFields(rule({ mode: 'gradient' }))

    await wrapper.find('input[aria-label="区间上端"]').setValue('42')

    expect(lastWrite(wrapper)?.gradient).toMatchObject({ min: 0, max: 42 })
  })

  // 档位在切走时仍然留着：切回来还想用原来那几档
  it('切成渐变不丢已配的档位', async () => {
    const wrapper = mountFields(TWO_STOPS)

    await buttonByText(wrapper, '区间渐变').trigger('click')

    expect(lastWrite(wrapper)?.mode).toBe('gradient')
    expect(lastWrite(wrapper)?.stops).toHaveLength(2)
  })
})

describe('改一档', () => {
  it('只动那一档，别的原样带走', async () => {
    const wrapper = mountFields(TWO_STOPS)
    const rows = wrapper.findAllComponents(TintStopRow)

    rows[1]?.vm.$emit('update:modelValue', {
      ...TWO_STOPS.stops[1],
      color: '#0000ff',
    })
    await wrapper.vm.$nextTick()

    const stops = lastWrite(wrapper)?.stops ?? []
    expect(stops[0]?.color).toBe('#00ff00')
    expect(stops[1]?.color).toBe('#0000ff')
  })

  // 首尾的按钮是禁用的，但挪动方向由子组件上抛，越界必须在这里挡住
  it('挪出表外是空操作，不把档位丢掉', async () => {
    const wrapper = mountFields(TWO_STOPS)

    wrapper.findAllComponents(TintStopRow)[0]?.vm.$emit('move', -1)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('清空区间上端写回 0，不是把它删成 undefined', async () => {
    const wrapper = mountFields(rule({ mode: 'gradient' }))

    await wrapper.find('input[aria-label="区间上端"]').setValue('')

    expect(lastWrite(wrapper)?.gradient.max).toBe(0)
  })
})
