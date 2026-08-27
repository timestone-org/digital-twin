/**
 * @fileoverview 契约：摆位五档各有各的编辑面，九档锚点一档不少，长度框解析不出就不写回。
 *
 * ⚠ 九档是本轮的验收线：参考项目的编辑器只给四档，手写 `'c'` 渲染得出来却选不到，
 * 一改就丢。这条用例按 `TWIN_2D_ANCHORS` 逐档点一遍，少一格当场红。
 * ⚠ 长度框逐键解析，`5e` 是 `5em` 打到一半：写回去会被压成 0，于是 `em` 与小数点
 * 永远打不完。
 */
import type { DtSelectOption } from '@dt/contracts'
import { TWIN_2D_ANCHORS, TWIN_2D_PLACEMENT_KINDS } from '@dt/twin2d'
import type { Twin2dPlacement } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlacementField from '@/pages/Twin2dEditor/components/fields/PlacementField.vue'

function mountField(at: Twin2dPlacement) {
  return mount(PlacementField, { props: { modelValue: at } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dPlacement {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回摆位')
  return events[events.length - 1]?.[0] as Twin2dPlacement
}

const FLOW: Twin2dPlacement = { kind: 'flow' }
const FILL: Twin2dPlacement = { kind: 'fill', inset: [0, 0, 0, 0] }
const ABS: Twin2dPlacement = {
  kind: 'abs',
  left: null,
  right: null,
  top: null,
  bottom: null,
  tx: '0',
  ty: '0',
}
const ANCHOR: Twin2dPlacement = { kind: 'anchor', anchor: 'c', dx: 0, dy: 0 }
const PERIM: Twin2dPlacement = { kind: 'perim', t: 0, gap: 0, dx: 0, dy: 0 }

describe('五档切换', () => {
  it('五档都摆得出选项', () => {
    const wrapper = mountField(FLOW)
    const options: readonly DtSelectOption[] = wrapper
      .findComponent(DtSelect)
      .props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_PLACEMENT_KINDS,
    ])
  })

  // ⚠ 缺省抄一份就会与归一化漂开，新换的这一档存一次再读回来会悄悄变样
  it('换档取的是归一化缺省', () => {
    const wrapper = mountField(FLOW)

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'anchor')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'anchor',
      anchor: 'c',
      dx: 0,
      dy: 0,
    })
  })

  it('换成同一档不写回', () => {
    const wrapper = mountField(ANCHOR)

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'anchor')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('认不出的档位不写回', () => {
    const wrapper = mountField(FLOW)

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('排流档只说明位置由父级决定，不摆任何取值', () => {
    const wrapper = mountField(FLOW)

    expect(wrapper.find('[data-test="placement-flow-hint"]').exists()).toBe(
      true,
    )
    expect(wrapper.findAll('input')).toHaveLength(0)
  })
})

describe('九档锚点', () => {
  it('九档一档不少', () => {
    const wrapper = mountField(ANCHOR)

    for (const anchor of TWIN_2D_ANCHORS) {
      expect(
        wrapper.find(`[data-test="placement-anchor-${anchor}"]`).exists(),
      ).toBe(true)
    }
    expect(wrapper.findAll('[role="group"] button')).toHaveLength(
      TWIN_2D_ANCHORS.length,
    )
  })

  it('点一档只换锚点，微调留着', async () => {
    const wrapper = mountField({ ...ANCHOR, dx: 6, dy: -3 })

    await wrapper.find('[data-test="placement-anchor-br"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'anchor',
      anchor: 'br',
      dx: 6,
      dy: -3,
    })
  })

  it('当前那一档是按下态', () => {
    const wrapper = mountField({ ...ANCHOR, anchor: 'tl' })

    expect(
      wrapper
        .find('[data-test="placement-anchor-tl"]')
        .attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper
        .find('[data-test="placement-anchor-c"]')
        .attributes('aria-pressed'),
    ).toBe('false')
  })

  it('两格微调各写各的', async () => {
    const wrapper = mountField(ANCHOR)
    const box = wrapper.find('[data-test="placement-anchor-dy"]')

    await box.setValue('12')

    expect(lastWrite(wrapper)).toEqual({ ...ANCHOR, dy: 12 })
  })
})

describe('铺满档', () => {
  it('四向内缩各一格', () => {
    const wrapper = mountField(FILL)

    expect(wrapper.findAll('input')).toHaveLength(4)
  })

  it('三种长度写法都收', async () => {
    const wrapper = mountField(FILL)

    await wrapper.find('[data-test="placement-inset-i0"]').setValue('8')
    expect(lastWrite(wrapper)).toEqual({ kind: 'fill', inset: [8, 0, 0, 0] })

    await wrapper.find('[data-test="placement-inset-i1"]').setValue('10%')
    expect(lastWrite(wrapper)).toEqual({
      kind: 'fill',
      inset: [0, '10%', 0, 0],
    })

    await wrapper.find('[data-test="placement-inset-i2"]').setValue('1em')
    expect(lastWrite(wrapper)).toEqual({
      kind: 'fill',
      inset: [0, 0, '1em', 0],
    })
  })

  // ⚠ 打到一半的 `5e` 写回去会被压成 0，于是 em 永远打不完
  it('打到一半的写法不写回文档', async () => {
    const wrapper = mountField(FILL)

    await wrapper.find('[data-test="placement-inset-i3"]').setValue('5e')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('失焦时把框拨回文档里的值', async () => {
    const wrapper = mountField({ kind: 'fill', inset: [4, 0, 0, 0] })
    const box = wrapper.find('[data-test="placement-inset-i0"]')

    await wrapper.find('.flex').trigger('focusin')
    await box.setValue('5e')
    await wrapper.find('.flex').trigger('focusout')

    expect(
      (
        wrapper.find('[data-test="placement-inset-i0"]')
          .element as HTMLInputElement
      ).value,
    ).toBe('4')
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})

describe('绝对定位档', () => {
  it('四边留空就是这一边不给', async () => {
    const wrapper = mountField({ ...ABS, top: 12 })

    await wrapper.find('[data-test="placement-abs-top"]').setValue('')

    expect(lastWrite(wrapper)).toEqual({ ...ABS, top: null })
  })

  it('四边各写各的', async () => {
    const wrapper = mountField(ABS)

    await wrapper.find('[data-test="placement-abs-right"]').setValue('16')

    expect(lastWrite(wrapper)).toEqual({ ...ABS, right: 16 })
  })

  // ⚠ tx/ty 是进 transform 的自由串，缺省必须与渲染层的兜底逐字相同
  it('自身位移经消毒，外链回落到不推移', async () => {
    const wrapper = mountField({ ...ABS, tx: '-50%' })

    await wrapper.find('[data-test="placement-tx"]').setValue('url(a.png)')

    expect(lastWrite(wrapper)).toEqual({ ...ABS, tx: '0' })
  })

  it('百分比位移原样写回', async () => {
    const wrapper = mountField(ABS)

    await wrapper.find('[data-test="placement-ty"]').setValue('-115%')

    expect(lastWrite(wrapper)).toEqual({ ...ABS, ty: '-115%' })
  })
})

describe('周长档', () => {
  it('四格取值各写各的', async () => {
    const wrapper = mountField(PERIM)
    const box = wrapper.find('[data-test="placement-perim-gap"]')

    await box.setValue('6')

    expect(lastWrite(wrapper)).toEqual({ ...PERIM, gap: 6 })
  })

  it('周长位置夹在 0 到 1 之间', async () => {
    const wrapper = mountField(PERIM)
    const box = wrapper.find('[data-test="placement-perim-t"]')

    await box.setValue('9')

    expect(lastWrite(wrapper)).toEqual({ ...PERIM, t: 1 })
  })

  it('两格微调各写各的', async () => {
    const wrapper = mountField(PERIM)
    const box = wrapper.find('[data-test="placement-perim-dx"]')

    await box.setValue('-4')

    expect(lastWrite(wrapper)).toEqual({ ...PERIM, dx: -4 })
  })
})
