/**
 * @fileoverview 契约：变体条件七档都配得出来，填不全的那几档当场标红，取反的层数上限
 * 与归一化那一份对齐。
 *
 * ⚠ 填不全的一条会被 `normalizeCondition` 整条丢弃：图元的 `when` 于是变成恒渲染、
 * 变体则整条消失，两处都零报错。
 * ⚠ 槽位读数的界值留空是「永不成立」不是「不限」——不标出来，用户配的报警变体一次
 * 都不会亮，而每一格取值单看都对。
 * ⚠ 取反再深一层会让整条条件被判空，不是只丢里面那一层。
 */
import { TWIN_2D_CONDITION_KINDS, normalizeCondition } from '@dt/twin2d'
import type { Twin2dCondition } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConditionField from '@/pages/Twin2dEditor/components/inspector/prim/ConditionField.vue'

const HOVER: Twin2dCondition = { kind: 'state', state: 'hover' }

function mountField(
  modelValue: Twin2dCondition | null,
  extra: { depth?: number; required?: boolean } = {},
) {
  return mount(ConditionField, { props: { modelValue, ...extra } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dCondition | null {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回条件')
  return events[events.length - 1]?.[0] as Twin2dCondition | null
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

/** 套 `count` 层取反的一条条件。 */
function nested(count: number): Twin2dCondition {
  let cond: Twin2dCondition = HOVER
  for (let round = 0; round < count; round += 1)
    cond = { kind: 'not', of: cond }
  return cond
}

describe('档位', () => {
  it('七档一档不少', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField(HOVER),
      'cond-kind',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual([
      ...TWIN_2D_CONDITION_KINDS,
    ])
  })

  it('还没有条件时只摆一个新增键', () => {
    const wrapper = mountField(null)

    expect(wrapper.find('[data-test="cond-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="cond-kind"]').exists()).toBe(false)
  })

  it('新增给的是一条立得住的条件', async () => {
    const wrapper = mountField(null)

    await wrapper.find('[data-test="cond-add"]').trigger('click')

    expect(normalizeCondition(lastWrite(wrapper))).not.toBeNull()
  })

  // ⚠ 从「节点标签」那一档出发，免得换到自己那一档时按「没变」提早返回
  it('换档给的每一档都认得出 kind', () => {
    const from: Twin2dCondition = { kind: 'tag', key: 'k', in: ['a'] }
    const others = TWIN_2D_CONDITION_KINDS.filter((one) => one !== 'tag')

    for (const kind of others) {
      const wrapper = mountField(from)

      selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', kind)

      expect(lastWrite(wrapper)?.kind, kind).toBe(kind)
    }
  })

  it('换档给的每一档落盘时都留得住', () => {
    const from: Twin2dCondition = { kind: 'tag', key: 'k', in: ['a'] }
    const filled = ['state', 'status', 'not']

    for (const kind of filled) {
      const wrapper = mountField(from)

      selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', kind)

      expect(normalizeCondition(lastWrite(wrapper)), kind).not.toBeNull()
    }
  })

  it('换成取反时把当下这条收进去', () => {
    const wrapper = mountField({ kind: 'status', in: ['alarm'] })

    selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', 'not')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'not',
      of: { kind: 'status', in: ['alarm'] },
    })
  })

  it('换成本来那一档什么都不写', () => {
    const wrapper = mountField(HOVER)

    selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', 'state')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('认不出的档位什么都不写', () => {
    const wrapper = mountField(HOVER)

    selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('取反的层数', () => {
  // ⚠ 这两条把控件里的上限与 normalizeCondition 里那份私有上限钉在一起
  it('四层取反落盘时留得住', () => {
    expect(normalizeCondition(nested(4))).not.toBeNull()
  })

  it('五层取反落盘时整条被丢掉', () => {
    expect(normalizeCondition(nested(5))).toBeNull()
  })

  it('最深那一层的取反禁用', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField(HOVER, { depth: 3 }),
      'cond-kind',
    ).props('options')

    expect(options.find((one) => one.value === 'not')?.disabled).toBe(true)
  })

  it('浅一层时取反放开', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountField(HOVER, { depth: 2 }),
      'cond-kind',
    ).props('options')

    expect(options.find((one) => one.value === 'not')?.disabled).toBe(false)
  })

  it('最深那一层挡住换成取反', () => {
    const wrapper = mountField(HOVER, { depth: 3 })

    selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', 'not')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  // ⚠ 递归实例只能从 DOM 上找：自引用解析出来的组件对象与 import 进来的那个不是同一个
  it('取反里面那一条改了照样包回来', () => {
    const wrapper = mountField({ kind: 'not', of: HOVER })
    const kinds = wrapper
      .findAllComponents(DtSelect)
      .filter((one) => one.attributes('data-test') === 'cond-kind')

    kinds[1]?.vm.$emit('update:modelValue', 'status')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'not',
      of: { kind: 'status', in: ['alarm'] },
    })
  })

  it('取反里面那一条是必填的，不摆清除键', () => {
    const wrapper = mountField({ kind: 'not', of: HOVER })

    expect(wrapper.findAll('[data-test="cond-clear"]')).toHaveLength(1)
  })
})

describe('运行状态', () => {
  it('勾一档按闭合表的次序收', async () => {
    const wrapper = mountField({ kind: 'status', in: ['alarm'] })

    await wrapper.find('[data-test="cond-status-online"] input').setValue(true)

    expect(lastWrite(wrapper)).toEqual({
      kind: 'status',
      in: ['online', 'alarm'],
    })
  })

  it('一档都不勾时当场标红', async () => {
    const wrapper = mountField({ kind: 'status', in: ['alarm'] })

    await wrapper.find('[data-test="cond-status-alarm"] input').setValue(false)
    await wrapper.setProps({ modelValue: { kind: 'status', in: [] } })

    expect(wrapper.find('[data-test="cond-status-empty"]').exists()).toBe(true)
  })
})

describe('节点标签', () => {
  it('空键当场标红', () => {
    const wrapper = mountField({ kind: 'tag', key: '', in: ['a'] })

    expect(wrapper.find('[data-test="cond-tag-key"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有标签键')
  })

  it('键写回文档', async () => {
    const wrapper = mountField({ kind: 'tag', key: '', in: ['a'] })

    await wrapper.find('[data-test="cond-tag-key"]').setValue('subtype')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'tag',
      key: 'subtype',
      in: ['a'],
    })
  })

  it('名单写回这一档自己的键', async () => {
    const wrapper = mountField({ kind: 'tag', key: 'subtype', in: [] })

    await wrapper.find('[data-test="cond-list"] input').setValue('a, b')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'tag',
      key: 'subtype',
      in: ['a', 'b'],
    })
  })

  it('空名单当场标红', () => {
    const wrapper = mountField({ kind: 'tag', key: 'subtype', in: [] })

    expect(wrapper.text()).toContain('空名单')
  })
})

describe('槽位读数', () => {
  it('空槽键当场标红', () => {
    const cond: Twin2dCondition = {
      kind: 'slot',
      slot: '',
      op: 'gte',
      value: 1,
      value2: null,
    }

    expect(mountField(cond).text()).toContain('没有槽键')
  })

  // ⚠ 留空不是「不限」而是「永不成立」
  it('界值留空时当场标红', () => {
    const cond: Twin2dCondition = {
      kind: 'slot',
      slot: 'heat',
      op: 'gte',
      value: null,
      value2: null,
    }

    expect(mountField(cond).text()).toContain('永不成立')
  })

  it('只有区间那两档才摆第二个界', () => {
    const one: Twin2dCondition = {
      kind: 'slot',
      slot: 'heat',
      op: 'gte',
      value: 1,
      value2: null,
    }
    const both: Twin2dCondition = { ...one, op: 'between' }

    expect(mountField(one).find('[data-test="cond-value2"]').exists()).toBe(
      false,
    )
    expect(mountField(both).find('[data-test="cond-value2"]').exists()).toBe(
      true,
    )
  })

  it('界值与算子各写各的', async () => {
    const cond: Twin2dCondition = {
      kind: 'slot',
      slot: 'heat',
      op: 'gte',
      value: null,
      value2: null,
    }
    const wrapper = mountField(cond)

    await wrapper.find('[data-test="cond-value"]').setValue('40')
    expect(lastWrite(wrapper)).toEqual({ ...cond, value: 40 })

    selectAt(wrapper, 'cond-op').vm.$emit('update:modelValue', 'lt')
    expect(lastWrite(wrapper)).toEqual({ ...cond, op: 'lt' })
  })

  it('认不出的算子不写回', () => {
    const cond: Twin2dCondition = {
      kind: 'slot',
      slot: 'heat',
      op: 'gte',
      value: 1,
      value2: null,
    }
    const wrapper = mountField(cond)

    selectAt(wrapper, 'cond-op').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('槽位有没有值', () => {
  it('槽键名单写回 slots', async () => {
    const wrapper = mountField({ kind: 'has', slots: [], mode: 'any' })

    await wrapper.find('[data-test="cond-list"] input').setValue('heat, power')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'has',
      slots: ['heat', 'power'],
      mode: 'any',
    })
  })

  it('判定两档写回', () => {
    const wrapper = mountField({ kind: 'has', slots: ['heat'], mode: 'any' })

    selectAt(wrapper, 'cond-mode').vm.$emit('update:modelValue', 'all')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'has',
      slots: ['heat'],
      mode: 'all',
    })
  })

  it('认不出的判定不写回', () => {
    const wrapper = mountField({ kind: 'has', slots: ['heat'], mode: 'any' })

    selectAt(wrapper, 'cond-mode').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('节点字段', () => {
  it('字段与判据各写各的', () => {
    const cond: Twin2dCondition = {
      kind: 'field',
      field: 'labelPos',
      test: 'in',
      in: ['top'],
    }
    const wrapper = mountField(cond)

    selectAt(wrapper, 'cond-field').vm.$emit('update:modelValue', 'badge')
    expect(lastWrite(wrapper)).toEqual({ ...cond, field: 'badge' })

    selectAt(wrapper, 'cond-test').vm.$emit('update:modelValue', 'present')
    expect(lastWrite(wrapper)).toEqual({ ...cond, test: 'present' })
  })

  it('认不出的字段与判据都不写回', () => {
    const cond: Twin2dCondition = {
      kind: 'field',
      field: 'labelPos',
      test: 'in',
      in: ['top'],
    }
    const wrapper = mountField(cond)

    selectAt(wrapper, 'cond-field').vm.$emit('update:modelValue', 'nope')
    selectAt(wrapper, 'cond-test').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  // ⚠ present 一档本来就不带名单，摆一个空名单红字会把人往错路上带
  it('只要有值那一档不摆名单', () => {
    const cond: Twin2dCondition = {
      kind: 'field',
      field: 'badge',
      test: 'present',
      in: [],
    }

    expect(mountField(cond).find('[data-test="cond-list"]').exists()).toBe(
      false,
    )
  })

  it('落在名单里那一档的空名单当场标红', () => {
    const cond: Twin2dCondition = {
      kind: 'field',
      field: 'badge',
      test: 'in',
      in: [],
    }

    expect(mountField(cond).text()).toContain('空名单')
  })
})

describe('清除', () => {
  it('必填那一处不摆清除键', () => {
    const wrapper = mountField(HOVER, { required: true })

    expect(wrapper.find('[data-test="cond-clear"]').exists()).toBe(false)
  })

  it('可空那一处清除写回不判条件', async () => {
    const wrapper = mountField(HOVER)

    await wrapper.find('[data-test="cond-clear"]').trigger('click')

    expect(lastWrite(wrapper)).toBeNull()
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountField(HOVER)

    await wrapper.find('div').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
