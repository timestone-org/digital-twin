/**
 * @fileoverview 契约：位置输入框显示的是基准读数、写回的是世界坐标。
 *
 * ⚠ 这两条方向必须对称：只换显示不换写回，用户填 0 会被存成世界原点；
 * 只换写回不换显示，同一个点每打开一次就往外跳一个原点。两种都不报错。
 */
import type { Vec3 } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PositionField from '@/pages/TwinEditor/components/fields/PositionField.vue'
import type { TwinFrameView } from '@/pages/TwinEditor/scripts/coordFrame'

/** 原点挪到 (10, 0, -30)：模型中心那一档的典型取值。 */
const CENTER: TwinFrameView = { mode: 'center', origin: [10, 0, -30] }
const WORLD: TwinFrameView = { mode: 'model', origin: [0, 0, 0] }

function mountField(modelValue: Vec3, frame: TwinFrameView = CENTER) {
  return mount(PositionField, { props: { modelValue, frame } })
}

type Wrapper = ReturnType<typeof mountField>

function axisInput(wrapper: Wrapper, axis: string) {
  const found = wrapper.find(`input[aria-label="${axis}"]`)
  if (!found.exists()) throw new Error(`没有 ${axis} 输入框`)
  return found
}

function shownValues(wrapper: Wrapper): string[] {
  return ['X', 'Y', 'Z'].map(
    (axis) => (axisInput(wrapper, axis).element as HTMLInputElement).value,
  )
}

function written(wrapper: Wrapper): Vec3 {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回位置')
  return events[events.length - 1]?.[0] as Vec3
}

describe('读数', () => {
  it('显示的是世界坐标减基准原点', () => {
    const wrapper = mountField([12, 4, -25])

    expect(shownValues(wrapper)).toEqual(['2', '4', '5'])
  })

  it('基准原点上的点显示成三个 0', () => {
    const wrapper = mountField([10, 0, -30])

    expect(shownValues(wrapper)).toEqual(['0', '0', '0'])
  })

  it('原点就在世界原点上时读数即世界坐标', () => {
    const wrapper = mountField([12, 4, -25], WORLD)

    expect(shownValues(wrapper)).toEqual(['12', '4', '-25'])
  })
})

describe('写回', () => {
  // ⚠ 写回世界坐标而不是读数：存读数的话换一次基准，落库的点就跟着漂
  it('填进去的是读数，写回的是世界坐标', async () => {
    const wrapper = mountField([12, 4, -25])

    await axisInput(wrapper, 'X').setValue('0')

    expect(written(wrapper)).toEqual([10, 4, -25])
  })

  it('只改一个轴，另外两个轴的世界坐标原样带上', async () => {
    const wrapper = mountField([12, 4, -25])

    await axisInput(wrapper, 'Z').setValue('10')

    expect(written(wrapper)).toEqual([12, 4, -20])
  })

  it('原点在世界原点上时填什么就存什么', async () => {
    const wrapper = mountField([0, 0, 0], WORLD)

    await axisInput(wrapper, 'Y').setValue('7')

    expect(written(wrapper)).toEqual([0, 7, 0])
  })
})

describe('提示', () => {
  it('原点不在世界原点上时把「0 在哪」和原点写出来', () => {
    const wrapper = mountField([12, 4, -25])

    expect(wrapper.text()).toContain('0 在模型中心')
    expect(wrapper.text()).toContain('10 / 0 / -30')
  })

  it('模型原点那一档说的是模型原点', () => {
    const wrapper = mountField([1, 2, 3], { mode: 'model', origin: [4, 1, -2] })

    expect(wrapper.text()).toContain('0 在模型原点')
  })

  // 那时读数就是世界坐标，多一行只是噪声
  it('原点就在世界原点上时一行提示都不出', () => {
    const wrapper = mountField([1, 2, 3], WORLD)

    expect(wrapper.text()).not.toContain('0 在模型')
  })
})
