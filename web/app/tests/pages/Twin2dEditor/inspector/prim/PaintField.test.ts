/**
 * @fileoverview 契约：SVG 上色三档；引了本图元里没有的渐变时当场标红，一个渐变都没有
 * 时那一档禁用。
 *
 * ⚠ SVG 对 `fill="url(#缺)"` 是整个不上色，画面上只剩描边，看着像「填充色配错了」。
 * ⚠ 引空了的那个 id 也要摆进下拉，不然用户连「它现在指着谁」都看不出来。
 */
import { TWIN_2D_PAINT_KINDS } from '@dt/twin2d'
import type { Twin2dPaint } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaintField from '@/pages/Twin2dEditor/components/inspector/prim/PaintField.vue'

function mountField(
  modelValue: Twin2dPaint,
  gradientIds: readonly string[] = [],
) {
  return mount(PaintField, { props: { modelValue, gradientIds } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dPaint {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回上色')
  return events[events.length - 1]?.[0] as Twin2dPaint
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('三档', () => {
  it('一档不少', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField({ kind: 'none' }),
      'paint-kind',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual([...TWIN_2D_PAINT_KINDS])
  })

  // ⚠ 禁用而不是删掉：删了之后导进来的图元会让下拉显示成空白
  it('一个渐变都没有时渐变那一档禁用', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField({ kind: 'none' }),
      'paint-kind',
    ).props('options')

    expect(options.find((one) => one.value === 'gradient')?.disabled).toBe(true)
  })

  it('有渐变时那一档放开', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField({ kind: 'none' }, ['g1']),
      'paint-kind',
    ).props('options')

    expect(options.find((one) => one.value === 'gradient')?.disabled).toBe(
      false,
    )
  })

  it('换纯色时给一档看得见的颜色', () => {
    const wrapper = mountField({ kind: 'none' })

    selectAt(wrapper, 'paint-kind').vm.$emit('update:modelValue', 'color')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'color',
      color: 'currentColor',
    })
  })

  it('换渐变时落到第一条已建的渐变上', () => {
    const wrapper = mountField({ kind: 'none' }, ['g1', 'g2'])

    selectAt(wrapper, 'paint-kind').vm.$emit('update:modelValue', 'gradient')

    expect(lastWrite(wrapper)).toEqual({ kind: 'gradient', id: 'g1' })
  })

  it('一个渐变都没有时换渐变落回不上色', () => {
    const wrapper = mountField({ kind: 'color', color: 'red' })

    selectAt(wrapper, 'paint-kind').vm.$emit('update:modelValue', 'gradient')

    expect(lastWrite(wrapper)).toEqual({ kind: 'none' })
  })

  it('换成本来那一档什么都不写', () => {
    const wrapper = mountField({ kind: 'none' })

    selectAt(wrapper, 'paint-kind').vm.$emit('update:modelValue', 'none')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('颜色', () => {
  it('经消毒，外链回落到取自身文字色', async () => {
    const wrapper = mountField({ kind: 'color', color: 'red' })

    await wrapper.find('.dt-color__text input').setValue('url(a.png)')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'color',
      color: 'currentColor',
    })
  })
})

describe('渐变引用', () => {
  it('挑另一条写回那一条', () => {
    const wrapper = mountField({ kind: 'gradient', id: 'g1' }, ['g1', 'g2'])

    selectAt(wrapper, 'paint-gradient').vm.$emit('update:modelValue', 'g2')

    expect(lastWrite(wrapper)).toEqual({ kind: 'gradient', id: 'g2' })
  })

  it('引空了当场标红', () => {
    const wrapper = mountField({ kind: 'gradient', id: 'gone' }, ['g1'])

    expect(selectAt(wrapper, 'paint-gradient').props('error')).toContain(
      '整个不上色',
    )
  })

  it('引空了的那个 id 也摆进下拉', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField({ kind: 'gradient', id: 'gone' }, ['g1']),
      'paint-gradient',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual(['g1', 'gone'])
  })

  it('引得到时不标红', () => {
    const wrapper = mountField({ kind: 'gradient', id: 'g1' }, ['g1'])

    expect(selectAt(wrapper, 'paint-gradient').props('error')).toBe('')
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountField({ kind: 'none' })

    await wrapper.find('div').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
