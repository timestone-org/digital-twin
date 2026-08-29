/**
 * @fileoverview 契约：外观风格下拉里那一段「我的样式」。
 *
 * ⚠ 两条要害：套用户样式是**整袋替换**（逐键合并会留上一套的残留，用户看到的是
 * 「换了样式但没换干净」）；下拉里只列这个模块套得上的（列了套不上的等于摆一个
 * 点下去只写一半的按钮）。
 */
import type { CardStyle, DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import CardStyleFields from '@/components/chrome/CardStyleFields.vue'
import {
  provideCardStyles,
  stylesForModule,
} from '@/features/dashboard/cardStyleLibrary'

function style(over: Partial<CardStyle> = {}): CardStyle {
  return {
    id: 's1',
    name: '蓝调科技卡',
    description: '呼吸描边',
    moduleType: null,
    chrome: { radius: 4, borderStyle: 'breathe' },
    config: {},
    thumbnail: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

/** 把字段组挂在一个装了样式库的宿主里。 */
function mountWithLibrary(
  styles: readonly CardStyle[],
  props: Record<string, unknown> = {},
): ReturnType<typeof mount> {
  const host = defineComponent({
    setup() {
      provideCardStyles(() => styles)
      return () =>
        h(CardStyleFields, {
          modelValue: {},
          ...props,
          'onUpdate:modelValue': (next: unknown) => {
            emitted.push(next)
          },
        })
    },
  })
  emitted.length = 0
  return mount(host)
}

const emitted: unknown[] = []

function optionValues(wrapper: ReturnType<typeof mount>): string[] {
  const options: readonly DtSelectOption[] = wrapper
    .findComponent(DtSelect)
    .props('options')
  return options.map((one) => one.value)
}

describe('哪些样式套得上', () => {
  it('通用外壳样式对任何模块都成立', () => {
    expect(stylesForModule([style()], 'info-card')).toHaveLength(1)
  })

  it('绑了类型的只对同类型成立', () => {
    const bound = [style({ id: 's2', moduleType: 'gauge-card' })]

    expect(stylesForModule(bound, 'gauge-card')).toHaveLength(1)
    expect(stylesForModule(bound, 'info-card')).toEqual([])
  })

  // ⚠ 大屏级缺省面板没有「哪个模块」这个上下文，绑了类型的在那里只会写一半
  it('不给模块类型时只剩通用外壳样式', () => {
    const mixed = [style(), style({ id: 's2', moduleType: 'gauge-card' })]

    expect(stylesForModule(mixed, null).map((one) => one.id)).toEqual(['s1'])
  })
})

describe('外观风格下拉', () => {
  it('没装样式库时只有内置那两档', () => {
    const wrapper = mount(CardStyleFields, { props: { modelValue: {} } })

    expect(optionValues(wrapper)).toEqual(['default', 'minimal'])
  })

  it('装了就在内置后面追加我的样式', () => {
    const wrapper = mountWithLibrary([style()])

    expect(optionValues(wrapper)).toEqual(['default', 'minimal', 'saved:s1'])
  })

  it('套不上的那些一个都不列', () => {
    const wrapper = mountWithLibrary(
      [style({ id: 's2', moduleType: 'gauge-card' })],
      { moduleType: 'info-card' },
    )

    expect(optionValues(wrapper)).toEqual(['default', 'minimal'])
  })

  // ⚠ 逐键合并会把上一套没被新样式提到的键留在屏上
  it('套一条样式是整袋替换，不是逐键合并', () => {
    const wrapper = mountWithLibrary([style()], {
      modelValue: { titleRule: 'hatch', radius: 12 },
    })
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'saved:s1')

    expect(emitted.at(-1)).toEqual({ radius: 4, borderStyle: 'breathe' })
  })

  // ⚠ 回填成内置那档的话，用户会以为自己那条没存上
  it('取值与内置某档逐键相同时，回填的是用户那条', () => {
    const wrapper = mountWithLibrary([style()], {
      modelValue: { radius: 4, borderStyle: 'breathe' },
    })

    expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe('saved:s1')
  })

  it('取值落在所有样式之外时仍回填自定义', () => {
    const wrapper = mountWithLibrary([style()], {
      modelValue: { radius: 9 },
    })

    expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe('custom')
  })
})
