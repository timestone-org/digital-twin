/**
 * @fileoverview 契约：部件详情这一节把标题、弹窗里那块 3D、风格与字段都配得出来，
 * 字段列表复用信息牌那一份、行号按摊平后的全局位次报。
 *
 * ⚠ 字段一律占绑定行，与「近距点击弹不弹窗」无关：这里改字段只写 `detail`，
 * 不碰点击动作。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinPart, TwinPartDetail } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PartDetailFields from '@/pages/TwinEditor/components/fields/PartDetailFields.vue'
import PanelFieldList from '@/pages/TwinEditor/components/fields/PanelFieldList.vue'

function partOf(over: Record<string, unknown> = {}): TwinPart {
  const part = normalizeTwinConfig({
    parts: [{ id: 'p1', name: '冷水机组', ...over }],
  }).parts[0]
  if (part === undefined) throw new Error('造不出部件')
  return part
}

function render(over: Record<string, unknown> = {}, rowOffset = 0) {
  return mount(PartDetailFields, { props: { part: partOf(over), rowOffset } })
}

type Wrapper = ReturnType<typeof render>

function lastDetail(wrapper: Wrapper): TwinPartDetail {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回详情')
  return events[events.length - 1]?.[0] as TwinPartDetail
}

/** 只有一个下拉：数据卡片的风格。 */
function variantSelect(wrapper: Wrapper) {
  const found = wrapper.findComponent(DtSelect)
  if (!found.exists()) throw new Error('没有风格下拉')
  return found
}

/** 按可见文案找一个开关。 */
function switchByText(wrapper: Wrapper, text: string) {
  const found = wrapper
    .findAll('button[role="switch"]')
    .find((item) => item.text().includes(text))
  if (found === undefined) throw new Error(`没有「${text}」这个开关`)
  return found
}

describe('标题与风格', () => {
  it('标题留空时把「会用部件名」写出来', () => {
    expect(render().text()).toContain('冷水机组')
  })

  it('改风格只动 variant', () => {
    const wrapper = render({ detail: { accent: '--state-danger' } })

    variantSelect(wrapper).vm.$emit('update:modelValue', 'hud')

    expect(lastDetail(wrapper)).toMatchObject({
      variant: 'hud',
      accent: '--state-danger',
    })
  })

  it('认不出的风格一个字都不写', () => {
    const wrapper = render()

    variantSelect(wrapper).vm.$emit('update:modelValue', '???')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('弹窗里那块 3D', () => {
  it('缺省画模型、也缺省自转', () => {
    const wrapper = render()

    expect(
      switchByText(wrapper, '弹窗里画这个部件的模型').attributes(
        'aria-checked',
      ),
    ).toBe('true')
    expect(switchByText(wrapper, '模型自转').attributes('aria-checked')).toBe(
      'true',
    )
  })

  it('关掉「画模型」后自转与高度一并收起', () => {
    const wrapper = render({ detail: { showModel: false } })

    expect(wrapper.text()).not.toContain('模型自转')
    expect(wrapper.text()).not.toContain('模型区高度')
  })

  it('关掉「画模型」只动这一个字段', async () => {
    const wrapper = render({ detail: { autoRotate: false } })

    await switchByText(wrapper, '弹窗里画这个部件的模型').trigger('click')

    expect(lastDetail(wrapper)).toMatchObject({
      showModel: false,
      autoRotate: false,
    })
  })

  it('宽度与高度都配得动', () => {
    const wrapper = render({ detail: { width: 900, modelHeight: 400 } })

    expect(wrapper.text()).toContain('弹窗宽度')
    expect(wrapper.text()).toContain('模型区高度')
  })
})

describe('字段', () => {
  it('用的就是信息牌那一份字段列表，措辞换成「部件」', () => {
    const wrapper = render()

    expect(wrapper.getComponent(PanelFieldList).props('owner')).toBe('部件')
    expect(wrapper.text()).toContain('实时值按所有部件字段摊平后的文档序对齐')
  })

  // ⚠ 行号是摊平后的全局位次：按本部件内序号报会让人以为插一行只影响自己
  it('行号从传进来的偏移接着数', () => {
    const wrapper = render(
      { detail: { fields: [{ key: 'temp', label: '温度' }] } },
      4,
    )

    expect(wrapper.text()).toContain('第 5 行')
  })

  it('改字段只写 detail，点击动作一个字不动', () => {
    const wrapper = render({ click: { near: 'detail' } })

    wrapper.getComponent(PanelFieldList).vm.$emit('update:fields', [])

    expect(lastDetail(wrapper).fields).toEqual([])
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('一个字段都没有时说清楚弹出来是空卡片', () => {
    expect(render().text()).toContain('这个部件上还没有字段')
  })
})
