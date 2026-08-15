/**
 * @fileoverview 契约：箭头检查器把「零向量不是方向」与拾取态摆在明面上。
 *
 * `direction` 渲染前会 normalize，零向量当没配（回退 +Y）——不提示的话，用户把三个
 * 分量清成 0 之后只会看到箭头忽然朝上。另锁住小数位的 null 档与拾取的两个事件。
 */
import { ALWAYS_VISIBLE, type TwinArrow } from '@dt/twin-config'
import { DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ArrowInspector from '@/pages/TwinEditor/components/inspector/ArrowInspector.vue'

function arrowOf(over: Partial<TwinArrow> = {}): TwinArrow {
  return {
    id: 'ar1',
    name: '进风',
    position: [0, 0, 0],
    direction: [0, 1, 0],
    length: 1,
    width: 1,
    labelText: '风量',
    prefix: '',
    unit: 'm³/h',
    decimals: null,
    color: '--accent-primary',
    visibility: ALWAYS_VISIBLE,
    ...over,
  }
}

function mountInspector(arrow: TwinArrow, picking = false) {
  return mount(ArrowInspector, { props: { modelValue: arrow, picking } })
}

type Wrapper = ReturnType<typeof mountInspector>

function written(wrapper: Wrapper): TwinArrow {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.[0]) throw new Error('没有写回箭头')
  return events[0][0] as TwinArrow
}

function pickButton(wrapper: Wrapper) {
  const found = wrapper
    .findAll('button')
    .find((item) => item.text().includes('拾取'))
  if (!found) throw new Error('未找到拾取按钮')
  return found
}

describe('零向量', () => {
  it('三个分量都是 0 时提示这样等于没配', () => {
    const wrapper = mountInspector(arrowOf({ direction: [0, 0, 0] }))

    expect(wrapper.text()).toContain('零向量不是一个方向')
  })

  it('有方向时不提示', () => {
    const wrapper = mountInspector(arrowOf())

    expect(wrapper.text()).not.toContain('零向量不是一个方向')
  })

  it('改一个分量也整份换新数组', async () => {
    const arrow = arrowOf()
    const wrapper = mountInspector(arrow)
    const input = wrapper.findAll('input[aria-label="X"]')[1]
    if (!input) throw new Error('未找到方向向量的 X 格')
    await input.setValue('2')
    await input.trigger('change')

    const next = written(wrapper)
    expect(next.direction).toEqual([2, 1, 0])
    expect(arrow.direction).toEqual([0, 1, 0])
  })
})

describe('从视口拾取位置', () => {
  it('未拾取时点一下请求拾取', async () => {
    const wrapper = mountInspector(arrowOf())
    expect(pickButton(wrapper).text()).toContain('从视口拾取')
    await pickButton(wrapper).trigger('click')

    expect(wrapper.emitted('requestPickPosition')).toHaveLength(1)
    expect(wrapper.emitted('cancelPick')).toBeUndefined()
  })

  it('拾取中点一下是取消，并说清楚现在该做什么', async () => {
    const wrapper = mountInspector(arrowOf(), true)
    expect(wrapper.text()).toContain('在视口里点一下')
    await pickButton(wrapper).trigger('click')

    expect(wrapper.emitted('cancelPick')).toHaveLength(1)
    expect(wrapper.emitted('requestPickPosition')).toBeUndefined()
  })
})

describe('小数位的 null 档', () => {
  it('不定位数时写明按原值上屏', () => {
    const wrapper = mountInspector(arrowOf())

    expect(wrapper.text()).toContain('不定位数')
  })

  it('关掉开关写回 null 而不是 0', async () => {
    const wrapper = mountInspector(arrowOf({ decimals: 1 }))
    const toggle = wrapper
      .findAllComponents(DtSwitch)
      .find((item) => item.props('ariaLabel') === '指定小数位')
    if (!toggle) throw new Error('未找到小数位开关')
    await toggle.setValue(false)

    expect(written(wrapper).decimals).toBeNull()
  })
})

describe('整份写回', () => {
  it('改标签文本不动原对象', async () => {
    const arrow = arrowOf()
    const wrapper = mountInspector(arrow)
    await wrapper.find('input[aria-label="标签固定文本"]').setValue('回风')

    expect(written(wrapper).labelText).toBe('回风')
    expect(arrow.labelText).toBe('风量')
  })

  it('改长度不动其余字段', async () => {
    const wrapper = mountInspector(arrowOf())
    const input = wrapper.find('input[aria-label="长度"]')
    await input.setValue('4')
    await input.trigger('change')

    const next = written(wrapper)
    expect(next.length).toBe(4)
    expect(next.width).toBe(1)
    expect(next.unit).toBe('m³/h')
  })
})
