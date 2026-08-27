/**
 * @fileoverview 契约：局部渐变的增删、两档互换与色标子表；渐变 id 是身份，改不得。
 *
 * ⚠ 坐标恒是包围盒的 0..1，与 vec 的坐标口径无关——跟着乘一遍盒尺寸会让渐变整个跑到
 * 形状外面去，画面上只剩纯色。
 * ⚠ 新条目照归一化缺省来的话一个色标都没有，加一条等于什么都没发生。
 */
import type { Twin2dGradient, Twin2dGradientStop } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GradientList from '@/pages/Twin2dEditor/components/inspector/prim/GradientList.vue'

type LinearGradient = Extract<Twin2dGradient, { kind: 'linear' }>
type RadialGradient = Extract<Twin2dGradient, { kind: 'radial' }>

function linear(
  over: Partial<Omit<LinearGradient, 'kind'>> = {},
): LinearGradient {
  return {
    kind: 'linear',
    id: 'g1',
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    stops: [{ id: 'g1-a', color: 'red', at: 0 }],
    ...over,
  }
}

function radial(stops: readonly Twin2dGradientStop[] = []): RadialGradient {
  return {
    kind: 'radial',
    id: 'g1',
    cx: 0.5,
    cy: 0.5,
    r: 0.5,
    fx: 0.5,
    fy: 0.5,
    stops,
  }
}

function mountList(rows: readonly Twin2dGradient[] = [linear()], usedId = '') {
  return mount(GradientList, {
    props: { modelValue: rows, usedId, hint: '还没有渐变' },
  })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dGradient[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回渐变表')
  return events[events.length - 1]?.[0] as readonly Twin2dGradient[]
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('增删', () => {
  it('空表时给说明与新增键', () => {
    const wrapper = mountList([])

    expect(wrapper.text()).toContain('还没有渐变')
    expect(wrapper.find('[data-test="grad-add"]').exists()).toBe(true)
  })

  // ⚠ 一个色标都没有的渐变加了等于没加
  it('新增一条落地就有两个色标', async () => {
    const wrapper = mountList([])

    await wrapper.find('[data-test="grad-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.stops.length).toBeGreaterThan(1)
  })

  it('新条目的 id 不与已有的重名', async () => {
    const wrapper = mountList([linear({ id: 'grad-aaaaaa' })])

    await wrapper.find('[data-test="grad-add"]').trigger('click')

    expect(lastWrite(wrapper)[1]?.id).not.toBe('grad-aaaaaa')
  })

  it('删除只删被点名的那一条', async () => {
    const wrapper = mountList([linear(), linear({ id: 'g2' })])

    await wrapper.find('[data-test="grad-remove-g1"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['g2'])
  })

  it('正被填充引着的那一条先标出来', () => {
    expect(mountList([linear()], 'g1').text()).toContain('填充正引着它')
    expect(mountList([linear()]).text()).not.toContain('填充正引着它')
  })
})

describe('两档互换', () => {
  // ⚠ 换一下就把色标清空的话，重配两个色标是最没必要的一次返工
  it('换径向时色标跟着过去', () => {
    const wrapper = mountList()

    selectAt(wrapper, 'grad-kind-g1').vm.$emit('update:modelValue', 'radial')
    const row = lastWrite(wrapper)[0]

    expect(row?.kind).toBe('radial')
    expect(row?.stops).toHaveLength(1)
  })

  it('换成本来那一档与认不出的档位都不写回', () => {
    const wrapper = mountList()

    selectAt(wrapper, 'grad-kind-g1').vm.$emit('update:modelValue', 'linear')
    selectAt(wrapper, 'grad-kind-g1').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('线性四格与径向五格各摆各的', () => {
    const one = mountList()
    const other = mountList([radial()])

    expect(one.find('[data-test="grad-x1-g1"]').exists()).toBe(true)
    expect(one.find('[data-test="grad-cx-g1"]').exists()).toBe(false)
    expect(other.find('[data-test="grad-cx-g1"]').exists()).toBe(true)
    expect(other.find('[data-test="grad-x1-g1"]').exists()).toBe(false)
  })

  it('线性坐标写得进去', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="grad-y2-g1"]').setValue('1')

    expect(lastWrite(wrapper)[0]).toMatchObject({ kind: 'linear', y2: 1 })
  })

  it('径向坐标写得进去', async () => {
    const wrapper = mountList([radial()])

    await wrapper.find('[data-test="grad-r-g1"]').setValue('0.8')

    expect(lastWrite(wrapper)[0]).toMatchObject({ kind: 'radial', r: 0.8 })
  })
})

describe('色标', () => {
  it('加一个色标落在末尾', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="grad-stop-add-g1"]').trigger('click')

    expect(lastWrite(wrapper)[0]?.stops).toHaveLength(2)
  })

  it('删一个色标只删那一个', async () => {
    const wrapper = mountList([
      linear({
        stops: [
          { id: 's1', color: 'red', at: 0 },
          { id: 's2', color: 'blue', at: 1 },
        ],
      }),
    ])

    await wrapper.find('[data-test="grad-stop-remove-s1"]').trigger('click')

    expect(lastWrite(wrapper)[0]?.stops.map((one) => one.id)).toEqual(['s2'])
  })

  it('色标位置夹在 0 到 1', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="grad-at-g1-a"]').setValue('3')

    expect(lastWrite(wrapper)[0]?.stops[0]?.at).toBe(1)
  })

  it('色标颜色经消毒', async () => {
    const wrapper = mountList()

    await wrapper
      .find('[data-test="grad-stop-g1-a"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper)[0]?.stops[0]?.color).toBe('currentColor')
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="grad-at-g1-a"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
