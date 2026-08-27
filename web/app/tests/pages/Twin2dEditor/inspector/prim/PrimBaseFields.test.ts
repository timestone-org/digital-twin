/**
 * @fileoverview 契约：四种图元共有的那十五项都改得到；「不动」写回的是空动画而不是
 * `none` 那一档，变换基点经消毒。
 *
 * ⚠ `{ kind: 'none' }` 与 `null` 渲染完全一样，两种写法并存会让同一份样式序列化出
 * 两种 JSON，而 diff 上看着像有人改过。
 * ⚠ 等比缩放落到 0 会让整枝塌成一个点，归一化只会把它顶回 1——用户看到的是「填了没生效」。
 */
import { normalizePrims } from '@dt/twin2d'
import type { Twin2dPrim, Twin2dPrimBase } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PrimBaseFields from '@/pages/Twin2dEditor/components/inspector/prim/PrimBaseFields.vue'

/** 一枚归一化过的图元，字段齐全。 */
function prim(over: Readonly<Record<string, unknown>> = {}): Twin2dPrim {
  const one = normalizePrims([{ id: 'p1', kind: 'box', ...over }], 0)[0]
  if (one === undefined) throw new Error('样例图元没造出来')
  return one
}

function mountFields(modelValue: Twin2dPrimBase = prim()) {
  return mount(PrimBaseFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dPrimBase {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回图元')
  return events[events.length - 1]?.[0] as Twin2dPrimBase
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('尺寸', () => {
  it('宽高各写各的', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-w"] input').setValue('120')

    expect(lastWrite(wrapper).size).toEqual({ w: 120, h: 'auto' })
  })

  it('最小宽与最大宽留空即不限', async () => {
    const wrapper = mountFields(prim({ maxWidth: 200 }))

    await wrapper.find('[data-test="base-max-w"] input').setValue('')

    expect(lastWrite(wrapper).maxWidth).toBeNull()
  })

  it('最大宽写得进去', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-max-w"] input').setValue('50%')

    expect(lastWrite(wrapper).maxWidth).toBe('50%')
  })
})

describe('层与不透明', () => {
  it('层号可正可负', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-z"]').setValue('-2')

    expect(lastWrite(wrapper).z).toBe(-2)
  })

  it('不透明度夹在 0 到 1', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-opacity"]').setValue('2')

    expect(lastWrite(wrapper).opacity).toBe(1)
  })

  it('藏起这一枝是一个开关', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-hidden"] input').setValue(true)

    expect(lastWrite(wrapper).hidden).toBe(true)
  })
})

describe('变换', () => {
  it('旋转与等比缩放各写各的', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-rotate"]').setValue('90')
    expect(lastWrite(wrapper).rotate).toBe(90)

    await wrapper.find('[data-test="base-scale"]').setValue('1.2')
    expect(lastWrite(wrapper).scale).toBe(1.2)
  })

  // ⚠ 0 会让整枝塌成一个点
  it('等比缩放夹在正数', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-scale"]').setValue('0')

    expect(lastWrite(wrapper).scale).toBeGreaterThan(0)
  })

  it('变换基点经消毒，外链回落到居中', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-origin"]').setValue('url(a.png)')

    expect(lastWrite(wrapper).transformOrigin).toBe('50% 50%')
  })

  it('变换基点失焦时把框拨回文档里的值', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-origin"]').setValue('url(a.png)')
    await wrapper.find('[data-test="base-origin"]').trigger('focusout')

    const box = wrapper.find('[data-test="base-origin"]')
      .element as HTMLInputElement
    expect(box.value).toBe('50% 50%')
  })

  it('保持正立是一个开关', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-upright"] input').setValue(true)

    expect(lastWrite(wrapper).keepUpright).toBe(true)
  })
})

describe('动效', () => {
  // ⚠ 两种写法并存会让同一份样式序列化出两种 JSON
  it('不动那一档写回的是空动画', () => {
    const wrapper = mountFields(prim({ anim: { kind: 'pulse' } }))

    selectAt(wrapper, 'base-anim').vm.$emit('update:modelValue', '')

    expect(lastWrite(wrapper).anim).toBeNull()
  })

  it('换一档动画时时长跟着过去', () => {
    const wrapper = mountFields(
      prim({ anim: { kind: 'pulse', durationMs: 2400 } }),
    )

    selectAt(wrapper, 'base-anim').vm.$emit('update:modelValue', 'blink')

    expect(lastWrite(wrapper).anim).toEqual({
      kind: 'blink',
      durationMs: 2400,
    })
  })

  it('没配动画时不摆时长格', () => {
    expect(mountFields().find('[data-test="base-anim-ms"]').exists()).toBe(
      false,
    )
  })

  it('时长写得进去', async () => {
    const wrapper = mountFields(prim({ anim: { kind: 'pulse' } }))

    await wrapper.find('[data-test="base-anim-ms"]').setValue('600')

    expect(lastWrite(wrapper).anim?.durationMs).toBe(600)
  })

  it('认不出的动画档位不写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'base-anim').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('过渡那一格与动画分开两处', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('[data-test="transition-prop-opacity"] input')
      .setValue(true)

    expect(lastWrite(wrapper).transition?.props).toEqual(['opacity'])
  })
})

describe('指针与条件', () => {
  it('指针事件两档写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'base-pointer').vm.$emit('update:modelValue', 'none')

    expect(lastWrite(wrapper).pointerEvents).toBe('none')
  })

  it('认不出的指针档位不写回', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'base-pointer').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('还没有条件时摆的是新增键', () => {
    const wrapper = mountFields()

    expect(wrapper.find('[data-test="cond-add"]').exists()).toBe(true)
  })

  it('加一条条件写回图元的 when', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="cond-add"]').trigger('click')

    expect(lastWrite(wrapper).when).not.toBeNull()
  })
})

describe('摆位', () => {
  it('换一档摆位写回图元的 at', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'placement-kind').vm.$emit('update:modelValue', 'anchor')

    expect(lastWrite(wrapper).at.kind).toBe('anchor')
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-z"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
