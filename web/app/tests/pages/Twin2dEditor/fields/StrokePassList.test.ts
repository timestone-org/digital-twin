/**
 * @fileoverview 契约：多遍描边的增删改与调序；线端与折角各三档闭合，虚线框逐键解析
 * 但框里留用户敲的原文。
 *
 * ⚠ 不留原文的话，「4 4」删掉末位后那个空格会被一并吃掉，再打就成了「48」——
 * 而它看着像输入框自己在跳。
 * ⚠ 线宽落到 0 时 SVG 什么都不画，整张图看着只是「引脚没了」，既不报错也不像 bug。
 */
import type { DtSelectOption } from '@dt/contracts'
import { TWIN_2D_STROKE_CAPS, TWIN_2D_STROKE_JOINS } from '@dt/twin2d'
import type { Twin2dStrokePass } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StrokePassList from '@/pages/Twin2dEditor/components/fields/StrokePassList.vue'

function pass(over: Partial<Twin2dStrokePass> = {}): Twin2dStrokePass {
  return {
    id: 'p1',
    width: 2,
    color: 'currentColor',
    dash: [],
    cap: 'butt',
    join: 'miter',
    opacity: 1,
    nonScaling: false,
    ...over,
  }
}

function mountList(rows: readonly Twin2dStrokePass[]) {
  return mount(StrokePassList, {
    props: { modelValue: rows, hint: '还没有描边' },
  })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dStrokePass[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回描边表')
  return events[events.length - 1]?.[0] as readonly Twin2dStrokePass[]
}

/** 按可见标签取那一个下拉——同一行里有两个，按序号取会跟着版式一起漂。 */
function selectBy(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有标着「${label}」的下拉`)
  return found
}

describe('增删', () => {
  it('空表时只给说明与新增键', () => {
    const wrapper = mountList([])

    expect(wrapper.text()).toContain('还没有描边')
    expect(wrapper.find('[data-test="stroke-add"]').exists()).toBe(true)
  })

  // ⚠ 0 宽的描边什么都不画
  it('新增一遍落在末尾且线宽是正数', async () => {
    const wrapper = mountList([pass()])

    await wrapper.find('[data-test="stroke-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.width).toBeGreaterThan(0)
    expect(rows[1]?.id).not.toBe('p1')
  })

  it('删除只删被点名的那一遍', async () => {
    const wrapper = mountList([pass(), pass({ id: 'p2' })])

    await wrapper.find('[data-test="stroke-remove-p2"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['p1'])
  })
})

describe('线端与折角', () => {
  it('线端三档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([pass()]),
      '线端',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_STROKE_CAPS,
    ])
  })

  it('折角三档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([pass()]),
      '折角',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_STROKE_JOINS,
    ])
  })

  it('选一档写回那一档', () => {
    const wrapper = mountList([pass()])

    selectBy(wrapper, '线端').vm.$emit('update:modelValue', 'round')

    expect(lastWrite(wrapper)[0]?.cap).toBe('round')
  })

  it('认不出的档位不写回', () => {
    const wrapper = mountList([pass()])

    selectBy(wrapper, '折角').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('虚线', () => {
  it('空白与逗号都当分隔', async () => {
    const wrapper = mountList([pass()])

    await wrapper.find('[data-test="stroke-dash-p1"]').setValue('4 4')
    expect(lastWrite(wrapper)[0]?.dash).toEqual([4, 4])

    await wrapper.find('[data-test="stroke-dash-p1"]').setValue('6, 2')
    expect(lastWrite(wrapper)[0]?.dash).toEqual([6, 2])
  })

  // ⚠ 与归一化的 dashOf 同一口径：逐段丢弃，整条虚线照旧
  it('认不出与负数的段逐个丢弃', async () => {
    const wrapper = mountList([pass()])

    await wrapper.find('[data-test="stroke-dash-p1"]').setValue('4 x -3 8')

    expect(lastWrite(wrapper)[0]?.dash).toEqual([4, 8])
  })

  it('框里留用户敲的原文', async () => {
    const wrapper = mountList([pass()])
    const box = wrapper.find('[data-test="stroke-dash-p1"]')

    await box.setValue('4 ')

    expect((box.element as HTMLInputElement).value).toBe('4 ')
  })

  it('失焦时把框拨回文档里的写法并抛 blur', async () => {
    const wrapper = mountList([pass({ dash: [8, 4] })])
    const box = wrapper.find('[data-test="stroke-dash-p1"]')

    await wrapper.find('.flex').trigger('focusin')
    await box.setValue('4 x')
    await wrapper.find('.flex').trigger('focusout')

    expect(
      (wrapper.find('[data-test="stroke-dash-p1"]').element as HTMLInputElement)
        .value,
    ).toBe('8 4')
    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})

describe('其余取值', () => {
  it('线宽与不透明度各写各的', async () => {
    const wrapper = mountList([pass()])

    await wrapper.find('[data-test="stroke-width-p1"]').setValue('3.5')
    expect(lastWrite(wrapper)[0]?.width).toBe(3.5)

    await wrapper.find('[data-test="stroke-opacity-p1"]').setValue('0.4')
    expect(lastWrite(wrapper)[0]?.opacity).toBe(0.4)
  })

  it('线宽不许落到 0', async () => {
    const wrapper = mountList([pass()])

    await wrapper.find('[data-test="stroke-width-p1"]').setValue('0')

    expect(lastWrite(wrapper)[0]?.width).toBeGreaterThan(0)
  })

  it('不随舞台缩放是一个开关', async () => {
    const wrapper = mountList([pass()])

    await wrapper
      .find('[data-test="stroke-nonscaling-p1"] input')
      .setValue(true)

    expect(lastWrite(wrapper)[0]?.nonScaling).toBe(true)
  })

  it('颜色经消毒，外链回落到取自身文字色', async () => {
    const wrapper = mountList([pass({ color: 'red' })])

    await wrapper
      .find('[data-test="stroke-row-p1"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper)[0]?.color).toBe('currentColor')
  })
})

describe('调序', () => {
  it('上下各挪一格', async () => {
    const wrapper = mountList([pass(), pass({ id: 'p2' })])

    await wrapper.find('[data-test="stroke-up-p2"]').trigger('click')
    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['p2', 'p1'])

    await wrapper.find('[data-test="stroke-down-p1"]').trigger('click')
    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['p2', 'p1'])
  })

  it('首遍上移与末遍下移都禁用', () => {
    const wrapper = mountList([pass(), pass({ id: 'p2' })])

    expect(
      wrapper.find('[data-test="stroke-up-p1"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.find('[data-test="stroke-down-p2"]').attributes('disabled'),
    ).toBeDefined()
  })
})
