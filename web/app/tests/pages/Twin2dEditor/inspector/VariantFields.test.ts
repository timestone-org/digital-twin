/**
 * @fileoverview 契约：一条变体的命中条件、根覆盖与逐枚图元的覆盖都改得到；调序在这里
 * 出请求，覆盖入口按摊平后的图元树列。
 *
 * ⚠ 变体按文档序求值、后者覆盖前者，这条规则不摆在明面上的话，用户配了两条互相覆盖
 * 的变体会以为其中一条坏了——而两条单看都对。
 * ⚠ 只列根层的话，挂在盒里的那些图元一枚都覆盖不到，而它们恰恰是最常被变体动的。
 * ⚠ 条件是必填的：判不出条件的一条变体会被整条丢弃，所以这一处不给「不判条件」的出口。
 */
import { normalizePrims } from '@dt/twin2d'
import type { Twin2dPrim, Twin2dVariant } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VariantFields from '@/pages/Twin2dEditor/components/inspector/VariantFields.vue'

/** 一棵两层的图元树：摊平之后是三枚。 */
const PRIMS: readonly Twin2dPrim[] = normalizePrims(
  [
    {
      id: 'frame',
      kind: 'box',
      children: [
        { id: 'title', kind: 'txt' },
        { id: 'dot', kind: 'vec', shape: { kind: 'rect' } },
      ],
    },
  ],
  0,
)

function variant(over: Partial<Twin2dVariant> = {}): Twin2dVariant {
  return {
    id: 'v1',
    when: { kind: 'state', state: 'hover' },
    patch: {},
    rootPatch: {},
    ...over,
  }
}

function mountFields(
  modelValue: Twin2dVariant = variant(),
  seat: { order?: number; total?: number } = {},
) {
  return mount(VariantFields, {
    props: {
      modelValue,
      prims: PRIMS,
      order: seat.order ?? 0,
      total: seat.total ?? 1,
    },
  })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dVariant {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回变体')
  return events[events.length - 1]?.[0] as Twin2dVariant
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('次序', () => {
  it('第几条与共几条都写在面上', () => {
    const wrapper = mountFields(variant(), { order: 1, total: 3 })

    expect(wrapper.text()).toContain('第 2 条 / 共 3 条')
  })

  // ⚠ 不说这条规则，两条互相覆盖的变体看着就是「其中一条坏了」
  it('后盖前这条规则写在面上', () => {
    expect(
      mountFields().find('[data-test="variant-order-hint"]').text(),
    ).toContain('排在后面的盖住前面的')
  })

  it('往前挪与往后挪各出各的请求', async () => {
    const wrapper = mountFields(variant(), { order: 1, total: 3 })

    await wrapper.find('[data-test="variant-up"]').trigger('click')
    expect(wrapper.emitted('move')?.[0]).toEqual(['backward'])

    await wrapper.find('[data-test="variant-down"]').trigger('click')
    expect(wrapper.emitted('move')?.[1]).toEqual(['forward'])
  })

  it('头一条上移与末一条下移都禁用', () => {
    const first = mountFields(variant(), { order: 0, total: 2 })
    const last = mountFields(variant(), { order: 1, total: 2 })

    expect(
      first.find('[data-test="variant-up"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      last.find('[data-test="variant-down"]').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('命中条件', () => {
  it('条件是必填的，不摆清除键', () => {
    expect(mountFields().find('[data-test="cond-clear"]').exists()).toBe(false)
  })

  it('换一档条件写回变体的 when', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'cond-kind').vm.$emit('update:modelValue', 'status')

    expect(lastWrite(wrapper).when).toEqual({ kind: 'status', in: ['alarm'] })
  })
})

describe('根覆盖', () => {
  it('打开一格写回变体的 rootPatch', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="root-lift-on"] input').setValue(true)

    expect(lastWrite(wrapper).rootPatch.lift).toBeDefined()
  })
})

describe('图元覆盖', () => {
  // ⚠ 只列根层的话，盒里那两枚一枚都覆盖不到
  it('可选项按摊平后的图元树列', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountFields(),
      'variant-add-patch',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual(['frame', 'title', 'dot'])
  })

  it('已经覆盖过的那一枚不再列', () => {
    const options: readonly DtSelectOption[] = selectAt(
      mountFields(variant({ patch: { frame: {} } })),
      'variant-add-patch',
    ).props('options')

    expect(options.map((one) => one.value)).toEqual(['title', 'dot'])
  })

  it('挑一枚就加一条空覆盖', () => {
    const wrapper = mountFields()

    selectAt(wrapper, 'variant-add-patch').vm.$emit('update:modelValue', 'dot')

    expect(lastWrite(wrapper).patch).toEqual({ dot: {} })
  })

  it('挑一枚已经覆盖过的什么都不写', () => {
    const wrapper = mountFields(variant({ patch: { dot: { hidden: true } } }))

    selectAt(wrapper, 'variant-add-patch').vm.$emit('update:modelValue', 'dot')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('每一枚被覆盖的图元一行', () => {
    const wrapper = mountFields(variant({ patch: { frame: {}, dot: {} } }))

    expect(wrapper.find('[data-test="vpatch-row-frame"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="vpatch-row-dot"]').exists()).toBe(true)
  })

  it('撤掉整条只撤那一枚', async () => {
    const wrapper = mountFields(variant({ patch: { frame: {}, dot: {} } }))

    await wrapper.find('[data-test="vpatch-remove-frame"]').trigger('click')

    expect(Object.keys(lastWrite(wrapper).patch)).toEqual(['dot'])
  })

  it('行里改一格写回那一枚的覆盖', async () => {
    const wrapper = mountFields(variant({ patch: { dot: {} } }))

    await wrapper
      .find('[data-test="vpatch-row-dot"] [data-test="base-z"]')
      .setValue('6')

    expect(lastWrite(wrapper).patch).toEqual({ dot: { z: 6 } })
  })

  // ⚠ 指空的补丁永远不会生效，而界面上它看着与别的一模一样
  it('指着不存在的图元时那一行标红', () => {
    const wrapper = mountFields(variant({ patch: { gone: {} } }))

    expect(wrapper.find('[data-test="vpatch-dangling-gone"]').exists()).toBe(
      true,
    )
  })

  it('一枚都没剩下时不摆新增下拉', () => {
    const all = { frame: {}, title: {}, dot: {} }
    const wrapper = mountFields(variant({ patch: all }))

    expect(wrapper.find('[data-test="variant-add-patch"]').exists()).toBe(false)
  })
})

describe('合并撤销的出口', () => {
  it('条件那一段的 blur 转上去', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="variant-when"]').trigger('focusout')

    expect((wrapper.emitted('blur') ?? []).length).toBeGreaterThan(0)
  })

  it('覆盖行的 blur 转上去', async () => {
    const wrapper = mountFields(variant({ patch: { dot: {} } }))

    await wrapper
      .find('[data-test="vpatch-row-dot"] [data-test="base-z"]')
      .trigger('focusout')

    expect((wrapper.emitted('blur') ?? []).length).toBeGreaterThan(0)
  })
})
