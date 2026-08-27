/**
 * @fileoverview 契约：引脚符号的四件——伸出长度、上色、几何与多遍描边。
 *
 * ⚠ 渐变那一档在这里画出来是空的（引脚没有局部渐变表），所以禁用但不从表里删：
 * 删了之后一份从别处导进来的渐变引脚会让下拉显示成空白，用户连它现在是哪一档都看不出来。
 * ⚠ 几何恒按 unit 画（盒的边长就是 length），所以这一面不许摆坐标口径——摆了就是一个
 * 改了没反应的下拉。
 */
import { TWIN_2D_PAINT_KINDS } from '@dt/twin2d'
import type { Twin2dPinMarker } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PinMarkerField from '@/pages/Twin2dEditor/components/fields/PinMarkerField.vue'

function marker(over: Partial<Twin2dPinMarker> = {}): Twin2dPinMarker {
  return {
    shape: { kind: 'line', x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
    strokes: [],
    fill: { kind: 'none' },
    length: 8,
    ...over,
  }
}

function mountField(value: Twin2dPinMarker) {
  return mount(PinMarkerField, { props: { modelValue: value } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dPinMarker {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回引脚符号')
  return events[events.length - 1]?.[0] as Twin2dPinMarker
}

function selectBy(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有标着「${label}」的下拉`)
  return found
}

describe('上色三档', () => {
  it('三档一档不少，渐变那一档禁着', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountField(marker()),
      '填充',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_PAINT_KINDS,
    ])
    expect(
      options.find((option) => option.value === 'gradient')?.disabled,
    ).toBe(true)
  })

  it('换成纯色时带一个跟随主题的颜色', () => {
    const wrapper = mountField(marker())

    selectBy(wrapper, '填充').vm.$emit('update:modelValue', 'color')

    expect(lastWrite(wrapper).fill).toEqual({
      kind: 'color',
      color: 'currentColor',
    })
  })

  it('换回不填充', () => {
    const wrapper = mountField(
      marker({ fill: { kind: 'color', color: 'red' } }),
    )

    selectBy(wrapper, '填充').vm.$emit('update:modelValue', 'none')

    expect(lastWrite(wrapper).fill).toEqual({ kind: 'none' })
  })

  it('换成同一档与接不住的档位都不写回', () => {
    const wrapper = mountField(marker())

    selectBy(wrapper, '填充').vm.$emit('update:modelValue', 'none')
    selectBy(wrapper, '填充').vm.$emit('update:modelValue', 'gradient')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('纯色那一档才摆颜色格', () => {
    const off = mountField(marker())
    const on = mountField(marker({ fill: { kind: 'color', color: 'red' } }))

    expect(off.find('.dt-t2-color').exists()).toBe(false)
    expect(on.find('.dt-t2-color').exists()).toBe(true)
  })
})

describe('长度与几何', () => {
  it('伸出长度写回', async () => {
    const wrapper = mountField(marker())

    await wrapper.find('[data-test="pin-length"]').setValue('12')

    expect(lastWrite(wrapper).length).toBe(12)
  })

  // ⚠ 引脚的几何盒边长就是 length，坐标口径在这里是没有意义的一档
  it('不摆坐标口径那一档', () => {
    expect(
      mountField(marker()).find('[data-test="geometry-coord"]').exists(),
    ).toBe(false)
  })

  it('也不给在画布上取点的键', () => {
    expect(
      mountField(marker()).find('[data-test="geometry-pick"]').exists(),
    ).toBe(false)
  })

  it('换几何时其余三件原样留着', () => {
    const wrapper = mountField(marker({ length: 12 }))

    selectBy(wrapper, '几何').vm.$emit('update:modelValue', 'ellipse')
    const next = lastWrite(wrapper)

    expect(next.shape.kind).toBe('ellipse')
    expect(next.length).toBe(12)
  })
})

describe('多遍描边', () => {
  it('一遍都没有时写明落盘会补一遍缺省', () => {
    expect(mountField(marker()).text()).toContain('2px 的缺省描边')
  })

  it('新增一遍写回整份符号', async () => {
    const wrapper = mountField(marker())

    await wrapper.find('[data-test="stroke-add"]').trigger('click')

    expect(lastWrite(wrapper).strokes).toHaveLength(1)
  })
})
