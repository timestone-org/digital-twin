/**
 * @fileoverview 契约：部件常态外观面板整份写回，且「没配颜色时不摆浓度与自发光」。
 *
 * ⚠ 颜色留空 = 不染色。摆着一个 0 浓度的滑块会让人以为「配了色但没生效」，
 * 而实际上是根本没有颜色可染。
 */
import { DEFAULT_PART_LOOK, type TwinPartLook } from '@dt/twin-config'
import { DtSlider } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PartLookFields from '@/pages/TwinEditor/components/fields/PartLookFields.vue'

function mountFields(over: Partial<TwinPartLook> = {}) {
  return mount(PartLookFields, {
    props: { modelValue: { ...DEFAULT_PART_LOOK, ...over } },
  })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): TwinPartLook {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回外观')
  return events[events.length - 1]?.[0] as TwinPartLook
}

function sliderByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSlider)
    .find((item) => item.props('label') === label)
  if (!found) throw new Error(`没有名为「${label}」的滑块`)
  return found
}

describe('不透明度', () => {
  it('拖滑块整份写回，其余字段原样带走', async () => {
    const wrapper = mountFields({ color: '#00ff00' })

    sliderByLabel(wrapper, '不透明度').vm.$emit('update:modelValue', 0.4)
    await wrapper.vm.$nextTick()

    expect(lastWrite(wrapper)).toMatchObject({ opacity: 0.4, color: '#00ff00' })
  })

  it('没配颜色时也摆得出来：透明度与染色互不牵连', () => {
    expect(() => sliderByLabel(mountFields(), '不透明度')).not.toThrow()
  })
})

describe('颜色与它的两个附属项', () => {
  it('没配颜色时不摆浓度与自发光，只说清为什么', () => {
    const wrapper = mountFields()

    expect(wrapper.findAllComponents(DtSlider)).toHaveLength(1)
    expect(wrapper.text()).toContain('常态色留空时不染色')
  })

  it('配了颜色才摆出浓度与自发光', () => {
    const wrapper = mountFields({ color: '#123456' })

    expect(() => sliderByLabel(wrapper, '染色浓度')).not.toThrow()
    expect(() => sliderByLabel(wrapper, '自发光')).not.toThrow()
  })

  // ⚠ 只清颜色不复位这两项的话，下次配色时会「配了色却看不出来」
  it('清除颜色时把浓度与自发光一并复位', async () => {
    const wrapper = mountFields({ color: '#123456', blend: 0, glow: 3 })

    const clear = wrapper
      .findAll('button')
      .find((item) => item.text().includes('清除常态色'))
    await clear?.trigger('click')

    expect(lastWrite(wrapper)).toEqual({
      opacity: 1,
      color: '',
      blend: DEFAULT_PART_LOOK.blend,
      glow: DEFAULT_PART_LOOK.glow,
    })
  })
})
