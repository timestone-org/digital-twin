/**
 * @fileoverview 契约：字体控件读得出五个子键、改一处写回整块，且**没设置的键不落库**——
 * 物化出来的空键会被渲染端认成「配过了」，主题再怎么换这一项都不动。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField, DtSelectOption } from '@dt/contracts'
import { DtColorInput, DtSelect } from '@dt/ui'

import FontControl from '@/features/dashboard/controls/FontControl.vue'

const FIELD: ConfigField = { key: 'titleFont', label: '标题字体', type: 'font' }

function mountFont(value: unknown) {
  return mount(FontControl, { props: { field: FIELD, value } })
}

/** 最后一次抛出的 `update`。 */
function lastUpdate(wrapper: ReturnType<typeof mountFont>): unknown[] {
  const events = wrapper.emitted('update') ?? []
  return events.at(-1) ?? []
}

function textValue(
  wrapper: ReturnType<typeof mountFont>,
  at: number,
): string | undefined {
  const el = wrapper.findAll('.dt-input__el').at(at)?.element
  return el instanceof HTMLInputElement ? el.value : undefined
}

function numberValue(
  wrapper: ReturnType<typeof mountFont>,
  at: number,
): string | undefined {
  const el = wrapper.findAll('.dt-number__el').at(at)?.element
  return el instanceof HTMLInputElement ? el.value : undefined
}

describe('显示现值', () => {
  it('五个子键各回显到自己的控件上', () => {
    const wrapper = mountFont({
      family: 'Inter',
      size: 16,
      weight: 600,
      letterSpacing: 1.5,
      color: '--accent-primary',
    })

    expect(textValue(wrapper, 0)).toBe('Inter')
    expect(numberValue(wrapper, 0)).toBe('16')
    expect(numberValue(wrapper, 1)).toBe('1.5')
    expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe('600')
    expect(wrapper.findComponent(DtColorInput).props('modelValue')).toBe(
      '--accent-primary',
    )
  })

  it('值不是对象时按没配过画，而不是把面板打不开', () => {
    const wrapper = mountFont('乱写的')

    expect(textValue(wrapper, 0)).toBe('')
    expect(numberValue(wrapper, 0)).toBe('')
  })

  it('字重是 CSS 关键字时补一条选项，不回显成空白', () => {
    const wrapper = mountFont({ weight: 'bold' })
    const select = wrapper.findComponent(DtSelect)
    const options: readonly DtSelectOption[] = select.props('options')

    expect(select.props('modelValue')).toBe('bold')
    expect(options.map((option) => option.value)).toContain('bold')
  })
})

describe('编辑上抛', () => {
  it('改字体族写回整块，打字算连续输入', async () => {
    const wrapper = mountFont({ family: 'Inter', size: 16 })

    await wrapper.findAll('.dt-input__el')[0]?.setValue('Roboto')

    expect(lastUpdate(wrapper)).toStrictEqual([
      { family: 'Roboto', size: 16 },
      true,
    ])
  })

  it('字重写回数字而不是它的字符串键', async () => {
    const wrapper = mountFont({})
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '700')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toStrictEqual([{ weight: 700 }, false])
  })

  it('颜色也是连续输入', async () => {
    const wrapper = mountFont({})
    wrapper.findComponent(DtColorInput).vm.$emit('update:modelValue', '#101010')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toStrictEqual([{ color: '#101010' }, true])
  })
})

describe('缺席键不物化', () => {
  it('只改一个子键时其余的键一个都不写', async () => {
    const wrapper = mountFont({})

    await wrapper.findAll('.dt-number__el')[0]?.setValue('20')

    expect(lastUpdate(wrapper)).toStrictEqual([{ size: 20 }, true])
  })

  it('清空一个子键是把它删掉，不是写成 undefined', async () => {
    const wrapper = mountFont({ family: 'Inter', size: 16 })

    await wrapper.findAll('.dt-input__el')[0]?.setValue('')

    expect(lastUpdate(wrapper)).toStrictEqual([{ size: 16 }, true])
  })

  it('清空字号同样是删键', async () => {
    const wrapper = mountFont({ family: 'Inter', size: 16 })

    await wrapper.findAll('.dt-number__el')[0]?.setValue('')

    expect(lastUpdate(wrapper)).toStrictEqual([{ family: 'Inter' }, true])
  })

  it('字重选回「跟随主题」也是删键', async () => {
    const wrapper = mountFont({ weight: 600, size: 12 })
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toStrictEqual([{ size: 12 }, false])
  })
})
