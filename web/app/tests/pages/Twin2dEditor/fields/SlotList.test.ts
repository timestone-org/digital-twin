/**
 * @fileoverview 契约：槽位表的增删改——键是寻址键所以走草稿、失焦才落；换到派生档时
 * 当场给一条算式；取值映射一行一条且键恒为字符串。
 *
 * ⚠ 派生而算式为空的槽会被归一化降级成实时槽，于是「我明明选了派生」在存一次之后自己
 * 变了回去，且零报错——所以换档那一下就得给一条算得出值的算式。
 * ⚠ 映射表的键是字符串：JSON 的键永远是字符串，标成数字时与数值读数比较会静默不相等。
 */
import { TWIN_2D_SLOT_KINDS, TWIN_2D_VALUE_FORMATS } from '@dt/twin2d'
import type { Twin2dSlot } from '@dt/twin2d'
import { BINDING_DATA_TYPES } from '@dt/contracts'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SlotList from '@/pages/Twin2dEditor/components/fields/SlotList.vue'

function slot(over: Partial<Twin2dSlot> = {}): Twin2dSlot {
  return {
    key: 'heat',
    label: '供热量',
    kind: 'live',
    dataType: 'number',
    unit: 'kWh',
    precision: null,
    format: 'auto',
    enumMap: {},
    placeholder: '—',
    primary: false,
    expr: null,
    ...over,
  }
}

function mountList(
  rows: readonly Twin2dSlot[],
  usage?: Readonly<Record<string, number>>,
) {
  return mount(SlotList, {
    props:
      usage === undefined ? { modelValue: rows } : { modelValue: rows, usage },
  })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dSlot[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回槽位表')
  return events[events.length - 1]?.[0] as readonly Twin2dSlot[]
}

function selectBy(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有标着「${label}」的下拉`)
  return found
}

describe('增删', () => {
  it('一个槽位都没有时给空态与新增键', () => {
    const wrapper = mountList([])

    expect(wrapper.find('[data-test="slot-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="slot-add"]').exists()).toBe(true)
  })

  it('新增一条落在末尾，键不与已有的重名', async () => {
    const wrapper = mountList([slot({ key: 'slot1' })])

    await wrapper.find('[data-test="slot-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.key).not.toBe('slot1')
    expect(rows[1]?.key).not.toBe('')
  })

  it('新槽位是实时档、没有算式', async () => {
    const wrapper = mountList([])

    await wrapper.find('[data-test="slot-add"]').trigger('click')

    expect(lastWrite(wrapper)[0]).toMatchObject({ kind: 'live', expr: null })
  })

  it('删除只删被点名的那一条', async () => {
    const wrapper = mountList([slot(), slot({ key: 'plan' })])

    await wrapper.find('[data-test="slot-remove-heat"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.key)).toEqual(['plan'])
  })
})

describe('改键', () => {
  it('逐键只写草稿，一个字都不写回文档', async () => {
    const wrapper = mountList([slot()])

    await wrapper.find('[data-test="slot-key-heat"]').setValue('heat2')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('失焦才落', async () => {
    const wrapper = mountList([slot()])
    const box = wrapper.find('[data-test="slot-key-heat"]')

    await box.setValue(' heat2 ')
    await box.trigger('focusout')

    expect(lastWrite(wrapper)[0]?.key).toBe('heat2')
  })

  it('改成另一条已经占着的键时落不下去且当场标红', async () => {
    const wrapper = mountList([slot(), slot({ key: 'plan' })])
    const box = wrapper.find('[data-test="slot-key-heat"]')

    await box.setValue('plan')
    expect(wrapper.text()).toContain('已经被另一个槽位占着')

    await box.trigger('focusout')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('改成空的时候落不下去且当场标红', async () => {
    const wrapper = mountList([slot()])
    const box = wrapper.find('[data-test="slot-key-heat"]')

    await box.setValue('  ')
    expect(wrapper.text()).toContain('整条丢掉')

    await box.trigger('focusout')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('旁边写着现在有几处引用着', () => {
    expect(mountList([slot()], { heat: 2 }).text()).toContain('有 2 处引用')
  })

  it('一处都没引用时明说改键是安全的', () => {
    expect(mountList([slot()], { heat: 0 }).text()).toContain('是安全的')
  })
})

describe('闭合取值的三个下拉', () => {
  it('来源两档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([slot()]),
      '来源',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_SLOT_KINDS,
    ])
  })

  it('数据类型四档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([slot()]),
      '数据类型',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...BINDING_DATA_TYPES,
    ])
  })

  it('格式档四档一档不少，自动那一档排头', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([slot()]),
      '格式档',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_VALUE_FORMATS,
    ])
  })

  it('换数据类型与换格式档各写各的，认不出的取值不写回', () => {
    const wrapper = mountList([slot()])

    selectBy(wrapper, '数据类型').vm.$emit('update:modelValue', 'enum')
    expect(lastWrite(wrapper)[0]).toMatchObject({ dataType: 'enum' })

    selectBy(wrapper, '格式档').vm.$emit('update:modelValue', 'nope')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })
})

describe('派生档与算式', () => {
  it('实时档不摆算式面', () => {
    expect(mountList([slot()]).find('[data-test="expr-kind"]').exists()).toBe(
      false,
    )
  })

  // ⚠ 派生而算式为空会被降级成实时槽，「我明明选了派生」存一次就自己变回去
  it('换到派生档时当场给一条算得出值的算式', () => {
    const wrapper = mountList([slot()])

    selectBy(wrapper, '来源').vm.$emit('update:modelValue', 'derived')

    expect(lastWrite(wrapper)[0]).toEqual({
      ...slot(),
      kind: 'derived',
      expr: { kind: 'lit', value: 0 },
    })
  })

  it('换回实时档时把算式清掉', () => {
    const wrapper = mountList([
      slot({ kind: 'derived', expr: { kind: 'lit', value: 1 } }),
    ])

    selectBy(wrapper, '来源').vm.$emit('update:modelValue', 'live')

    expect(lastWrite(wrapper)[0]).toMatchObject({ kind: 'live', expr: null })
  })

  it('认不出的来源档不写回', () => {
    const wrapper = mountList([slot()])

    selectBy(wrapper, '来源').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  // ⚠ 判据只借 normalizeExpr 一把尺，面板上标的与落盘时丢的必须是同一件事
  it('算式落不了盘时当场说明这个槽会降级', () => {
    const wrapper = mountList([
      slot({ kind: 'derived', expr: { kind: 'slot', slot: '' } }),
    ])

    expect(wrapper.find('[data-test="slot-expr-error-heat"]').text()).toContain(
      '降级成实时槽',
    )
  })

  it('算式落得了盘时不报警', () => {
    const wrapper = mountList([
      slot({ kind: 'derived', expr: { kind: 'lit', value: 1 } }),
    ])

    expect(wrapper.find('[data-test="slot-expr-error-heat"]').exists()).toBe(
      false,
    )
  })

  it('改算式写回这一条槽位', () => {
    const wrapper = mountList([
      slot({ kind: 'derived', expr: { kind: 'lit', value: 1 } }),
    ])

    selectBy(wrapper, '算子').vm.$emit('update:modelValue', 'slot')

    expect(lastWrite(wrapper)[0]?.expr).toEqual({ kind: 'slot', slot: '' })
  })
})

describe('取值映射', () => {
  it('一行一条读出来', () => {
    const wrapper = mountList([slot({ enumMap: { 1: '运行', 0: '停机' } })])
    const box = wrapper.find('[data-test="slot-enum-heat"]')

    expect((box.element as HTMLTextAreaElement).value).toContain('1 = 运行')
  })

  it('一行一条写回去，没有等号的行丢掉', async () => {
    const wrapper = mountList([slot()])

    await wrapper
      .find('[data-test="slot-enum-heat"]')
      .setValue('1 = 运行\n乱写的一行\n0 = 停机')

    expect(lastWrite(wrapper)[0]?.enumMap).toEqual({ 1: '运行', 0: '停机' })
  })

  it('同键只留最先那一条', async () => {
    const wrapper = mountList([slot()])

    await wrapper
      .find('[data-test="slot-enum-heat"]')
      .setValue('1 = 运行\n1 = 待机')

    expect(lastWrite(wrapper)[0]?.enumMap).toEqual({ 1: '运行' })
  })

  // ⚠ 直接往对象字面量上赋这个键会改到原型而不是加一个属性
  it('原型那个键只是一条普通映射，不会改到原型上', async () => {
    const wrapper = mountList([slot()])

    await wrapper
      .find('[data-test="slot-enum-heat"]')
      .setValue('__proto__ = 坏了')
    const map = lastWrite(wrapper)[0]?.enumMap ?? {}

    expect(Object.getOwnPropertyNames(map)).toContain('__proto__')
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype)
  })

  it('框里留用户敲的原文，失焦才拨回文档里的值', async () => {
    const wrapper = mountList([slot()])
    const box = wrapper.find('[data-test="slot-enum-heat"]')

    await box.setValue('1 = ')
    expect((box.element as HTMLTextAreaElement).value).toBe('1 = ')

    await box.trigger('focusout')
    expect((box.element as HTMLTextAreaElement).value).toBe('')
  })
})

describe('其余几格', () => {
  it('显示名、单位与占位符逐键写回', async () => {
    const wrapper = mountList([slot()])

    await wrapper.find('[data-test="slot-label-heat"]').setValue('累计热量')
    expect(lastWrite(wrapper)[0]?.label).toBe('累计热量')

    await wrapper.find('[data-test="slot-unit-heat"]').setValue('GJ')
    expect(lastWrite(wrapper)[0]?.unit).toBe('GJ')

    await wrapper.find('[data-test="slot-placeholder-heat"]').setValue('无')
    expect(lastWrite(wrapper)[0]?.placeholder).toBe('无')
  })

  it('小数位给了就定点', async () => {
    const wrapper = mountList([slot()])

    await wrapper.find('[data-test="slot-precision-heat"]').setValue('2')

    expect(lastWrite(wrapper)[0]?.precision).toBe(2)
  })

  it('小数位留空是「不定点」而不是零位', async () => {
    const wrapper = mountList([slot({ precision: 2 })])

    await wrapper.find('[data-test="slot-precision-heat"]').setValue('')

    expect(lastWrite(wrapper)[0]?.precision).toBeNull()
  })

  it('主读数是一个开关', async () => {
    const wrapper = mountList([slot()])

    await wrapper.find('[data-test="slot-primary-heat"] input').setValue(true)

    expect(lastWrite(wrapper)[0]?.primary).toBe(true)
  })
})
