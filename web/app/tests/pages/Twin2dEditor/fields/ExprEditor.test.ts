/**
 * @fileoverview 契约：派生槽算式的七档闭合小语言——深度上限在编辑器里当场拦住、
 * 分母 ≤ 0 当场说清、列表档的最后一项删不得、拼接的分隔符不去空白。
 *
 * ⚠ 超深不能等归一化静默处理：第三层再嵌一层会让那一枝判空，列表档一项都不剩时整条
 * 算式跟着变 null，用户看到的是「我配的算式存了一次就没了」，且零报错。
 * ⚠ 分母 0 给 0% 会让「没在跑」和「效率为零」在墙上长得一模一样，所以写死成 ≤0 时要红。
 */
import { TWIN_2D_EXPR_KINDS, TWIN_2D_MAX_EXPR_DEPTH } from '@dt/twin2d'
import type { Twin2dExpr } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ExprEditor from '@/pages/Twin2dEditor/components/fields/ExprEditor.vue'

const LIT: Twin2dExpr = { kind: 'lit', value: 0 }

function mountEditor(expr: Twin2dExpr | null, depth = 0) {
  return mount(ExprEditor, { props: { modelValue: expr, depth } })
}

type Wrapper = ReturnType<typeof mountEditor>

function lastWrite(wrapper: Wrapper): Twin2dExpr {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回算式')
  return events[events.length - 1]?.[0] as Twin2dExpr
}

/** 最外层那一个下拉；嵌套的算式各有各的。 */
function rootKind(wrapper: Wrapper) {
  return wrapper.findComponent(DtSelect)
}

describe('七档算子', () => {
  it('七档一档不少', () => {
    const options: readonly DtSelectOption[] = rootKind(mountEditor(LIT)).props(
      'options',
    )

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_EXPR_KINDS,
    ])
  })

  it('换成组合档时把这一条收成第一个操作数', () => {
    const wrapper = mountEditor({ kind: 'slot', slot: 'heat' })

    rootKind(wrapper).vm.$emit('update:modelValue', 'sum')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'sum',
      of: [{ kind: 'slot', slot: 'heat' }],
    })
  })

  it('换成比值档时分母是 1、倍数是百分数那一档', () => {
    const wrapper = mountEditor(LIT)

    rootKind(wrapper).vm.$emit('update:modelValue', 'ratio')

    expect(lastWrite(wrapper)).toMatchObject({
      den: { kind: 'lit', value: 1 },
      scale: 100,
    })
  })

  it('换成同一档与认不出的档位都不写回', () => {
    const wrapper = mountEditor(LIT)

    rootKind(wrapper).vm.$emit('update:modelValue', 'lit')
    rootKind(wrapper).vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('还没有算式时只给一个新建键', async () => {
    const wrapper = mountEditor(null)

    await wrapper.find('[data-test="expr-add"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual(LIT)
  })
})

describe('三层上限', () => {
  it('最深那一层只放得下槽位与写死值', () => {
    const options: readonly DtSelectOption[] = rootKind(
      mountEditor(LIT, TWIN_2D_MAX_EXPR_DEPTH - 1),
    ).props('options')
    const off = options
      .filter((option) => option.disabled === true)
      .map((option) => option.value)

    expect(off).toEqual(['first', 'ratio', 'sum', 'scale', 'join'])
  })

  it('最深那一层写明再嵌一层会被丢掉', () => {
    const wrapper = mountEditor(LIT, TWIN_2D_MAX_EXPR_DEPTH - 1)

    expect(wrapper.find('[data-test="expr-leaf-hint"]').text()).toContain(
      '算式最多三层',
    )
  })

  // ⚠ 禁用态只挡鼠标，挡不住别的路子进来的取值，所以写回那一步再拦一道
  it('最深那一层强行换成组合档也不写回', () => {
    const wrapper = mountEditor(LIT, TWIN_2D_MAX_EXPR_DEPTH - 1)

    rootKind(wrapper).vm.$emit('update:modelValue', 'sum')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('浅一层还没到上限，七档全开', () => {
    const options: readonly DtSelectOption[] = rootKind(
      mountEditor(LIT, TWIN_2D_MAX_EXPR_DEPTH - 2),
    ).props('options')

    expect(options.every((option) => option.disabled !== true)).toBe(true)
  })

  it('已经越界的那一层只给一句说明，连下拉都不摆', () => {
    const wrapper = mountEditor(LIT, TWIN_2D_MAX_EXPR_DEPTH)

    expect(wrapper.find('[data-test="expr-too-deep"]').text()).toContain(
      '超过了三层上限',
    )
    expect(wrapper.find('[data-test="expr-kind"]').exists()).toBe(false)
  })
})

describe('比值', () => {
  it('分子分母各自是一条算式，逐层往下加深度', () => {
    const wrapper = mountEditor({
      kind: 'ratio',
      num: LIT,
      den: { kind: 'slot', slot: 'plan' },
      scale: 100,
    })
    const nested = wrapper.findAllComponents(ExprEditor)

    expect(nested).toHaveLength(2)
    expect(nested.map((item) => item.props('depth'))).toEqual([1, 1])
  })

  it('分母是槽位时只给常规说明', () => {
    const wrapper = mountEditor({
      kind: 'ratio',
      num: LIT,
      den: { kind: 'slot', slot: 'plan' },
      scale: 100,
    })

    expect(wrapper.find('[data-test="expr-den-hint"]').text()).toContain(
      '分母 ≤ 0 时整式取空值',
    )
  })

  // ⚠ 分母 0 给 0% 会让「没在跑」和「效率为零」长得一样
  it('分母写死成 0 时当场标红', () => {
    const wrapper = mountEditor({
      kind: 'ratio',
      num: LIT,
      den: { kind: 'lit', value: 0 },
      scale: 100,
    })

    expect(wrapper.find('[data-test="expr-den-hint"]').text()).toContain(
      '永远取不到值',
    )
  })

  it('改分子只动分子', () => {
    const wrapper = mountEditor({
      kind: 'ratio',
      num: LIT,
      den: { kind: 'lit', value: 2 },
      scale: 100,
    })
    const nested = wrapper.findAllComponents(ExprEditor)

    nested[0]?.vm.$emit('update:modelValue', { kind: 'slot', slot: 'heat' })

    expect(lastWrite(wrapper)).toEqual({
      kind: 'ratio',
      num: { kind: 'slot', slot: 'heat' },
      den: { kind: 'lit', value: 2 },
      scale: 100,
    })
  })

  it('倍数写回', async () => {
    const wrapper = mountEditor({
      kind: 'ratio',
      num: LIT,
      den: { kind: 'lit', value: 2 },
      scale: 100,
    })

    await wrapper.find('[data-test="expr-ratio-scale"]').setValue('1')

    expect(lastWrite(wrapper)).toMatchObject({ scale: 1 })
  })
})

describe('列表三档', () => {
  it('加一项落在末尾', async () => {
    const wrapper = mountEditor({ kind: 'sum', of: [LIT] })

    await wrapper.find('[data-test="expr-arg-add"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual({ kind: 'sum', of: [LIT, LIT] })
  })

  it('删一项只删被点名的那一个', async () => {
    const wrapper = mountEditor({
      kind: 'first',
      of: [LIT, { kind: 'slot', slot: 'heat' }],
    })

    await wrapper.find('[data-test="expr-arg-remove-0"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'first',
      of: [{ kind: 'slot', slot: 'heat' }],
    })
  })

  // ⚠ 一项都不剩的列表档会被整条丢掉，于是这个槽悄悄降级成实时槽
  it('最后一项删不得', () => {
    const wrapper = mountEditor({ kind: 'sum', of: [LIT] })
    const remove = wrapper.find('[data-test="expr-arg-remove-0"]')

    expect(remove.attributes('disabled')).toBeDefined()
    expect(remove.attributes('title')).toContain('至少留一项')
  })

  it('改某一项只动那一项', () => {
    const wrapper = mountEditor({ kind: 'sum', of: [LIT, LIT] })
    const nested = wrapper.findAllComponents(ExprEditor)

    nested[1]?.vm.$emit('update:modelValue', { kind: 'lit', value: 7 })

    expect(lastWrite(wrapper)).toEqual({
      kind: 'sum',
      of: [LIT, { kind: 'lit', value: 7 }],
    })
  })

  // ⚠ `' · '` 里的空格正是分隔符本身，trim 掉两个读数就贴在一起
  it('拼接的分隔符原样写回，不去空白', async () => {
    const wrapper = mountEditor({ kind: 'join', of: [LIT], sep: '' })

    await wrapper.find('[data-test="expr-sep"]').setValue(' · ')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'join',
      of: [LIT],
      sep: ' · ',
    })
  })

  it('只有拼接那一档摆分隔符', () => {
    expect(
      mountEditor({ kind: 'sum', of: [LIT] })
        .find('[data-test="expr-sep"]')
        .exists(),
    ).toBe(false)
  })
})

describe('两种叶子', () => {
  it('空槽键当场标红', () => {
    const wrapper = mountEditor({ kind: 'slot', slot: '  ' })

    expect(wrapper.text()).toContain('整条丢弃')
  })

  it('槽键写回', async () => {
    const wrapper = mountEditor({ kind: 'slot', slot: '' })

    await wrapper.find('[data-test="expr-slot"]').setValue('heat')

    expect(lastWrite(wrapper)).toEqual({ kind: 'slot', slot: 'heat' })
  })

  it('写死的数写回', async () => {
    const wrapper = mountEditor(LIT)

    await wrapper.find('[data-test="expr-lit-number"]').setValue('12')

    expect(lastWrite(wrapper)).toEqual({ kind: 'lit', value: 12 })
  })

  // ⚠ `'0'` 与 0 在求值层是两回事，换形时不把值带过去
  it('换成文本形时不把数带过去', async () => {
    const wrapper = mountEditor({ kind: 'lit', value: 12 })

    await wrapper.find('[data-test="expr-lit-text"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual({ kind: 'lit', value: '' })
  })

  it('文本形写回的是原文', async () => {
    const wrapper = mountEditor({ kind: 'lit', value: 'kWh' })

    await wrapper.find('[data-test="expr-lit-string"]').setValue(' kW ')

    expect(lastWrite(wrapper)).toEqual({ kind: 'lit', value: ' kW ' })
  })

  it('换回数形时给 0', async () => {
    const wrapper = mountEditor({ kind: 'lit', value: 'kWh' })

    await wrapper.find('[data-test="expr-lit-text"]').trigger('click')

    expect(lastWrite(wrapper)).toEqual(LIT)
  })
})
