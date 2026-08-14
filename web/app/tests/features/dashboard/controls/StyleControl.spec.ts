/**
 * @fileoverview 契约：样式槽控件读得出七个子键、改一处写回整块，且**没设置的键不落库**——
 * 物化出来的空键会盖掉主题给的那一份。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { DtColorInput } from '@dt/ui'

import StyleControl from '@/features/dashboard/controls/StyleControl.vue'

const FIELD: ConfigField = {
  key: 'cardStyle',
  label: '卡片样式',
  type: 'style',
}

function mountStyle(value: unknown) {
  return mount(StyleControl, { props: { field: FIELD, value } })
}

/** 最后一次抛出的 `update`。 */
function lastUpdate(wrapper: ReturnType<typeof mountStyle>): unknown[] {
  const events = wrapper.emitted('update') ?? []
  return events.at(-1) ?? []
}

function inputValue(
  wrapper: ReturnType<typeof mountStyle>,
  at: number,
): string | undefined {
  const el = wrapper.findAll('.dt-input__el').at(at)?.element
  return el instanceof HTMLInputElement ? el.value : undefined
}

function numberValue(
  wrapper: ReturnType<typeof mountStyle>,
  at: number,
): string | undefined {
  const el = wrapper.findAll('.dt-number__el').at(at)?.element
  return el instanceof HTMLInputElement ? el.value : undefined
}

/** 前两个文本框是两个取色器自带的，边框是第三个。 */
const BORDER_INPUT = 2
const PADDING_INPUT = 3
const SHADOW_INPUT = 4
const RADIUS_NUMBER = 0
const OPACITY_NUMBER = 1

describe('显示现值', () => {
  it('七个子键各回显到自己的控件上', () => {
    const wrapper = mountStyle({
      color: '--text-primary',
      background: '--surface-panel',
      border: '1px solid var(--border-default)',
      borderRadius: 8,
      boxShadow: '0 0 12px var(--accent-primary)',
      padding: '8px 12px',
      opacity: 0.6,
    })

    expect(wrapper.findComponent(DtColorInput).props('modelValue')).toBe(
      '--text-primary',
    )
    expect(inputValue(wrapper, BORDER_INPUT)).toBe(
      '1px solid var(--border-default)',
    )
    expect(inputValue(wrapper, PADDING_INPUT)).toBe('8px 12px')
    expect(inputValue(wrapper, SHADOW_INPUT)).toBe(
      '0 0 12px var(--accent-primary)',
    )
    expect(numberValue(wrapper, RADIUS_NUMBER)).toBe('8')
    expect(numberValue(wrapper, OPACITY_NUMBER)).toBe('0.6')
  })

  it('不透明度 0 是实配的值，不当成没配过', () => {
    const wrapper = mountStyle({ opacity: 0 })

    expect(numberValue(wrapper, OPACITY_NUMBER)).toBe('0')
  })

  it('值不是对象时按没配过画', () => {
    const wrapper = mountStyle([1, 2])

    expect(inputValue(wrapper, BORDER_INPUT)).toBe('')
    expect(numberValue(wrapper, RADIUS_NUMBER)).toBe('')
  })
})

describe('编辑上抛', () => {
  it('改边框写回整块，打字算连续输入', async () => {
    const wrapper = mountStyle({ padding: '4px' })

    await wrapper.findAll('.dt-input__el')[BORDER_INPUT]?.setValue('2px dashed')

    expect(lastUpdate(wrapper)).toStrictEqual([
      { padding: '4px', border: '2px dashed' },
      true,
    ])
  })

  it('改前景色写回整块', async () => {
    const wrapper = mountStyle({})
    wrapper.findComponent(DtColorInput).vm.$emit('update:modelValue', '#fefefe')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toStrictEqual([{ color: '#fefefe' }, true])
  })
})

describe('缺席键不物化', () => {
  it('只改圆角时其余六个键一个都不写', async () => {
    const wrapper = mountStyle({})

    await wrapper.findAll('.dt-number__el')[RADIUS_NUMBER]?.setValue('12')

    expect(lastUpdate(wrapper)).toStrictEqual([{ borderRadius: 12 }, true])
  })

  it('清空阴影是把这个键删掉，不是写成 undefined', async () => {
    const wrapper = mountStyle({ boxShadow: '0 0 4px #000', padding: '2px' })

    await wrapper.findAll('.dt-input__el')[SHADOW_INPUT]?.setValue('')

    expect(lastUpdate(wrapper)).toStrictEqual([{ padding: '2px' }, true])
  })

  it('把不透明度改成 0 要写进去，不许当成清空', async () => {
    const wrapper = mountStyle({})

    await wrapper.findAll('.dt-number__el')[OPACITY_NUMBER]?.setValue('0')

    expect(lastUpdate(wrapper)).toStrictEqual([{ opacity: 0 }, true])
  })
})
