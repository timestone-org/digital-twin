/**
 * @fileoverview 契约：场景特效三段（星空 / 底座 / 光柱）。
 *
 * ⚠ 关掉的那一段要把字段**整段收起来**，不是留一排灰控件：灰着的控件看上去像
 * 「配得上但没生效」，收起来才说得清是压根没开。
 * ⚠ 三档取值一律从常量联合生成选项。手抄一份字符串的话，改契约时抄的那份不会
 * 跟着变，界面上会多出一个存不进去的档——选了没反应，也不报错。
 * ⚠ 写回只改自己那一段：三段共用一个 `modelValue`，写成整份覆盖会让改星空把
 * 底座与光柱的配置一起抹回默认。
 */
import {
  TWIN_LIGHT_COLUMN_MODES,
  TWIN_LIGHT_COLUMN_RISES,
  TWIN_PEDESTAL_REFLECTIONS,
  normalizeTwinConfig,
  type TwinSceneEffects,
} from '@dt/twin-config'
import { DtColorInput, DtSegmented, DtSelect, DtSlider, DtSwitch } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SceneEffectsFields from '@/pages/TwinEditor/components/fields/SceneEffectsFields.vue'

function effects(over: Record<string, unknown> = {}): TwinSceneEffects {
  return normalizeTwinConfig({ model: { sceneEffects: over } }).model
    .sceneEffects
}

/** 三段全开的一份，用来验字段真的摆出来了。 */
const ALL_ON = effects({
  starfield: { enabled: true },
  pedestal: { enabled: true },
  lightColumn: { enabled: true },
})

function mountFields(modelValue: TwinSceneEffects = effects()) {
  return mount(SceneEffectsFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): TwinSceneEffects {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回')
  return events[events.length - 1]?.[0] as TwinSceneEffects
}

/** 面板上摆出来的控件总数。⚠ 不能只数开关：光柱那一段展开后全是滑块与分段。 */
function controlCount(wrapper: Wrapper): number {
  return [DtSwitch, DtSlider, DtSelect, DtSegmented, DtColorInput].reduce(
    (total, one) => total + wrapper.findAllComponents(one).length,
    0,
  )
}

/** 按标签找开关。三段的启用开关是各段的第一个。 */
function switchByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSwitch)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有开关「${label}」`)
  return found
}

describe('关掉的段收起来', () => {
  it.each([
    ['starfield', '启用星空'],
    ['pedestal', '启用底座'],
    ['lightColumn', '启用光柱'],
  ])('%s 关着时只留启用开关本身', (key, label) => {
    const before = controlCount(mountFields())
    const after = controlCount(
      mountFields(effects({ [key]: { enabled: true } })),
    )

    expect(switchByLabel(mountFields(), label).props('modelValue')).toBe(false)
    // 开起来一定多出字段；不多说明这一段的 v-if 挂错了键
    expect(after).toBeGreaterThan(before)
  })

  it('三段全开时字段都摆出来', () => {
    const wrapper = mountFields(ALL_ON)

    expect(wrapper.findAllComponents(DtSwitch).length).toBeGreaterThan(3)
    expect(wrapper.findAllComponents(DtSelect).length).toBeGreaterThan(0)
    expect(wrapper.findAllComponents(DtSegmented).length).toBeGreaterThan(0)
  })
})

describe('写回只动自己那一段', () => {
  it.each([
    ['启用星空', 'starfield'],
    ['启用底座', 'pedestal'],
    ['启用光柱', 'lightColumn'],
  ])('切 %s 不碰另外两段', (label, key) => {
    const wrapper = mountFields(ALL_ON)

    switchByLabel(wrapper, label).vm.$emit('update:modelValue', false)

    const next = lastWrite(wrapper)
    expect(next[key as 'starfield'].enabled).toBe(false)
    for (const other of ['starfield', 'pedestal', 'lightColumn'] as const) {
      if (other === key) continue
      expect(next[other]).toEqual(ALL_ON[other])
    }
  })
})

/**
 * ⚠ 选项一律由常量联合生成：多一档少一档都要在这里红，而不是等到用户选了
 * 一个存不进去的值、界面上毫无反应。
 */
describe('三档取值来自常量联合', () => {
  it('底座反射的选项与常量逐个对上', () => {
    const select = mountFields(ALL_ON).findAllComponents(DtSelect)[0]
    const values = (
      select?.props('options') as readonly { value: string }[]
    ).map((item) => item.value)

    expect(values).toEqual([...TWIN_PEDESTAL_REFLECTIONS])
    expect(select?.props('hint')).toBeUndefined()
  })

  it('光柱的模式与上升方式各自与常量对上', () => {
    const segmented = mountFields(ALL_ON).findAllComponents(DtSegmented)
    const valuesOf = (index: number) =>
      (segmented[index]?.props('options') as readonly { value: string }[]).map(
        (item) => item.value,
      )

    expect(valuesOf(0)).toEqual([...TWIN_LIGHT_COLUMN_MODES])
    expect(valuesOf(1)).toEqual([...TWIN_LIGHT_COLUMN_RISES])
  })

  it('选一个不在联合里的值时一个字都不写回', () => {
    const wrapper = mountFields(ALL_ON)

    const selects = wrapper.findAllComponents(DtSelect)
    selects[0]?.vm.$emit('update:modelValue', '不存在的档')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('选一个合法的档写回它', () => {
    const wrapper = mountFields(ALL_ON)
    const target = TWIN_PEDESTAL_REFLECTIONS[1]

    const selects = wrapper.findAllComponents(DtSelect)
    selects[0]?.vm.$emit('update:modelValue', target)

    expect(lastWrite(wrapper).pedestal.reflection).toBe(target)
  })

  it.each([
    [0, TWIN_LIGHT_COLUMN_MODES[1], 'mode'],
    [1, TWIN_LIGHT_COLUMN_RISES[1], 'rise'],
  ])('分段控件 %i 写回光柱的 %s', (index, target, key) => {
    const wrapper = mountFields(ALL_ON)

    const segmented = wrapper.findAllComponents(DtSegmented)
    segmented[index]?.vm.$emit('update:modelValue', target)

    expect(lastWrite(wrapper).lightColumn[key as 'mode']).toBe(target)
  })
})
