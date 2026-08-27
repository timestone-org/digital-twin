/**
 * @fileoverview 契约：过渡的六档属性名闭合可勾，全不勾就是「没配过渡」（null），
 * 缓动串经消毒且缺省与渲染层的兜底逐字相同。
 *
 * ⚠ 全不勾必须落成 null：另开一个「启用」开关会造出「开着但一档都没勾」这种文档里
 * 表达不出来的状态，存一次再读回来它自己就变成了关着。
 */
import { TWIN_2D_TRANSITION_PROPS } from '@dt/twin2d'
import type { Twin2dTransition } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TransitionField from '@/pages/Twin2dEditor/components/fields/TransitionField.vue'

function mountField(value: Twin2dTransition | null) {
  return mount(TransitionField, { props: { modelValue: value } })
}

type Wrapper = ReturnType<typeof mountField>

/** 一档属性名的那个勾选框；`data-test` 落在 DtCheckbox 的 label 上。 */
function box(wrapper: Wrapper, prop: string) {
  return wrapper.find(`[data-test="transition-prop-${prop}"] input`)
}

function lastWrite(wrapper: Wrapper): Twin2dTransition | null {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回过渡')
  return events[events.length - 1]?.[0] as Twin2dTransition | null
}

const ONE: Twin2dTransition = {
  props: ['opacity'],
  durationMs: 180,
  easing: 'ease',
}

describe('六档属性名', () => {
  it('六档一档不少', () => {
    const wrapper = mountField(null)

    for (const prop of TWIN_2D_TRANSITION_PROPS) {
      expect(
        wrapper.find(`[data-test="transition-prop-${prop}"]`).exists(),
      ).toBe(true)
    }
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(
      TWIN_2D_TRANSITION_PROPS.length,
    )
  })

  it('从没配过渡勾上一档，其余取值由归一化补', async () => {
    const wrapper = mountField(null)

    await box(wrapper, 'transform').setValue(true)

    expect(lastWrite(wrapper)).toEqual({
      props: ['transform'],
      durationMs: 180,
      easing: 'ease',
    })
  })

  it('再勾一档时按闭合表的次序收，不按勾选顺序', async () => {
    const wrapper = mountField(ONE)

    await box(wrapper, 'transform').setValue(true)

    expect(lastWrite(wrapper)?.props).toEqual(['transform', 'opacity'])
  })

  // ⚠ 与归一化「props 空表即没配过渡」同一口径
  it('取消最后一档就落成没配过渡', async () => {
    const wrapper = mountField(ONE)

    await box(wrapper, 'opacity').setValue(false)

    expect(lastWrite(wrapper)).toBeNull()
  })

  it('没配过渡时只说明后果，不摆时长与缓动', () => {
    const wrapper = mountField(null)

    expect(wrapper.find('[data-test="transition-off-hint"]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[data-test="transition-duration"]').exists()).toBe(
      false,
    )
  })
})

describe('时长与缓动', () => {
  it('时长写回', async () => {
    const wrapper = mountField(ONE)

    await wrapper.find('[data-test="transition-duration"]').setValue('320')

    expect(lastWrite(wrapper)).toEqual({ ...ONE, durationMs: 320 })
  })

  // ⚠ 0 与负数在归一化里一律回缺省：那两个值给不出「不过渡」这个意思
  it('时长清空落回缺省', async () => {
    const wrapper = mountField({ ...ONE, durationMs: 400 })

    await wrapper.find('[data-test="transition-duration"]').setValue('')

    expect(lastWrite(wrapper)?.durationMs).toBe(180)
  })

  it('缓动原样写回', async () => {
    const wrapper = mountField(ONE)

    await wrapper
      .find('[data-test="transition-easing"]')
      .setValue('cubic-bezier(0.4, 0, 0.2, 1)')

    expect(lastWrite(wrapper)?.easing).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
  })

  // ⚠ 框里绝不留下一个文档里并不存在的取值：失焦时拨回文档里那一个
  it('缓动里的外链被拒，写回缺省且失焦时框跟着拨回', async () => {
    const wrapper = mountField(ONE)
    const easing = wrapper.find('[data-test="transition-easing"]')

    await easing.setValue('url(a.css)')
    expect(lastWrite(wrapper)?.easing).toBe('ease')

    await wrapper.find('div').trigger('focusout')

    expect((easing.element as HTMLInputElement).value).toBe('ease')
  })

  it('外部换值时缓动框跟着换', async () => {
    const wrapper = mountField(ONE)

    await wrapper.setProps({ modelValue: { ...ONE, easing: 'linear' } })

    expect(
      (
        wrapper.find('[data-test="transition-easing"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('linear')
  })
})

describe('合并撤销的出口', () => {
  it('焦点离开时抛 blur', async () => {
    const wrapper = mountField(ONE)

    await wrapper.find('div').trigger('focusin')
    await wrapper.find('div').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
