/**
 * @fileoverview 契约：边框四格各写各的，四条边全不勾时当场标红。
 *
 * ⚠ 线宽 0 与线型「无」是两条不同的路：变体补丁按键覆盖，两者覆盖出来的结果不同，
 * 所以两条都留着并各给一句说明。
 * ⚠ 四条边全不勾等于没有边框，而每一格取值单看都对——不标出来就成了「配了没反应」。
 */
import { TWIN_2D_BORDER_STYLES } from '@dt/twin2d'
import type { Twin2dBorder } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BorderField from '@/pages/Twin2dEditor/components/inspector/prim/BorderField.vue'

function border(over: Partial<Twin2dBorder> = {}): Twin2dBorder {
  return {
    width: 1,
    style: 'solid',
    color: 'currentColor',
    sides: { top: true, right: true, bottom: true, left: true },
    ...over,
  }
}

function mountField(value: Twin2dBorder = border()) {
  return mount(BorderField, { props: { modelValue: value } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dBorder {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回边框')
  return events[events.length - 1]?.[0] as Twin2dBorder
}

describe('线型', () => {
  it('四档一档不少', () => {
    const options: readonly DtSelectOption[] = mountField()
      .getComponent(DtSelect)
      .props('options')

    expect(options.map((one) => one.value)).toEqual([...TWIN_2D_BORDER_STYLES])
  })

  it('选一档写回那一档', () => {
    const wrapper = mountField()

    wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'dashed')

    expect(lastWrite(wrapper).style).toBe('dashed')
  })

  it('认不出的档位不写回', () => {
    const wrapper = mountField()

    wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('线宽', () => {
  it('写回新线宽', async () => {
    const wrapper = mountField()

    await wrapper.find('[data-test="border-width"]').setValue('2.5')

    expect(lastWrite(wrapper).width).toBe(2.5)
  })

  it('负线宽夹到 0', async () => {
    const wrapper = mountField()

    await wrapper.find('[data-test="border-width"]').setValue('-3')

    expect(lastWrite(wrapper).width).toBe(0)
  })

  // ⚠ 0 与「无」是两条不同的路，说明只在 0 那一下出现
  it('线宽 0 时给出「先不画」的说明', () => {
    expect(mountField(border({ width: 0 })).text()).toContain('先不画')
    expect(mountField().text()).not.toContain('先不画')
  })
})

describe('四条边', () => {
  it('只改被点名的那一条', async () => {
    const wrapper = mountField()

    await wrapper.find('[data-test="border-side-bottom"] input').setValue(false)

    expect(lastWrite(wrapper).sides).toEqual({
      top: true,
      right: true,
      bottom: false,
      left: true,
    })
  })

  it('全不勾时当场标红', () => {
    const none = { top: false, right: false, bottom: false, left: false }

    const wrapper = mountField(border({ sides: none }))

    expect(wrapper.find('[data-test="border-none"]').exists()).toBe(true)
  })

  it('勾着一条就不标红', () => {
    const one = { top: true, right: false, bottom: false, left: false }

    const wrapper = mountField(border({ sides: one }))

    expect(wrapper.find('[data-test="border-none"]').exists()).toBe(false)
  })
})

describe('颜色', () => {
  it('经消毒，外链回落到取自身文字色', async () => {
    const wrapper = mountField()

    await wrapper.find('.dt-color__text input').setValue('url(a.png)')

    expect(lastWrite(wrapper).color).toBe('currentColor')
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountField()

    await wrapper.find('div').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
