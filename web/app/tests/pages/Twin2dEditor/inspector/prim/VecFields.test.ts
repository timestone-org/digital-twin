/**
 * @fileoverview 契约：矢量那一档的几何、坐标口径、填充、描边与局部渐变都改得到，
 * 取点请求只转交、本件不碰画布。
 *
 * ⚠ 没人接取点请求时那个键就不摆：按下去毫无反应且零报错，比没有这个键更糟。
 * ⚠ 填充引的渐变从这一面上的渐变表来，删掉正被引的那一条会让这一笔整个不上色。
 */
import { normalizePrims } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import type { Twin2dPrim, Twin2dVecPrim } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VecFields from '@/pages/Twin2dEditor/components/inspector/prim/VecFields.vue'

function vecPrim(over: Readonly<Record<string, unknown>> = {}): Twin2dVecPrim {
  const one = normalizePrims(
    [{ id: 'p1', kind: 'vec', shape: { kind: 'rect' }, ...over }],
    0,
  )[0]
  if (one === undefined || one.kind !== 'vec')
    throw new Error('样例矢量没造出来')
  return one
}

function mountFields(modelValue: Twin2dVecPrim = vecPrim(), canPick = false) {
  return mount(VecFields, { props: { modelValue, canPick } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dVecPrim {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回矢量')
  const one = events[events.length - 1]?.[0] as Twin2dPrim
  if (one.kind !== 'vec') throw new Error('写回的不是矢量')
  return one
}

/** 按 data-test 取那一个下拉。 */
function selectAt(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((one) => one.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('几何', () => {
  it('几何那一格写回图元的 shape', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="geometry-w"]').setValue('0.8')

    expect(lastWrite(wrapper).shape).toMatchObject({ kind: 'rect', w: 0.8 })
  })

  // ⚠ 换的是坐标系不是数：静默换算会让图形在换档那一下整个跑掉
  it('坐标口径换档只换口径不换数', () => {
    const wrapper = mountFields(vecPrim({ coord: 'unit' }))

    selectAt(wrapper, 'geometry-coord').vm.$emit('update:modelValue', 'px')
    const next = lastWrite(wrapper)

    expect(next.coord).toBe('px')
    expect(next.shape).toEqual(vecPrim().shape)
  })

  it('拉伸填满是一个开关', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="vec-stretch"] input').setValue(true)

    expect(lastWrite(wrapper).stretch).toBe(true)
  })
})

describe('取点', () => {
  // ⚠ 没人接时不摆这个键
  it('上层接不住时不摆取点键', () => {
    expect(mountFields().find('[data-test="geometry-pick"]').exists()).toBe(
      false,
    )
  })

  it('上层接得住时把请求原样转交', async () => {
    const wrapper = mountFields(
      vecPrim({
        shape: {
          kind: 'poly',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
      }),
      true,
    )

    await wrapper.find('[data-test="geometry-pick"]').trigger('click')

    expect(wrapper.emitted('pick')?.[0]).toEqual(['poly'])
  })
})

describe('上色与描边', () => {
  it('填充那一格写回图元的 fill', async () => {
    const wrapper = mountFields(
      vecPrim({ fill: { kind: 'color', color: 'red' } }),
    )

    await wrapper
      .find('[data-test="vec-fill"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper).fill).toEqual({
      kind: 'color',
      color: 'currentColor',
    })
  })

  it('描边空表时给一句说明', () => {
    expect(mountFields().text()).toContain('SVG 缺省的 1px')
  })

  it('加一遍描边写回图元的 strokes', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('[data-test="vec-strokes"] [data-test="stroke-add"]')
      .trigger('click')

    expect(lastWrite(wrapper).strokes).toHaveLength(1)
  })
})

describe('局部渐变', () => {
  it('加一条渐变写回图元的 gradients', async () => {
    const wrapper = mountFields()

    await wrapper
      .find('[data-test="vec-gradients"] [data-test="grad-add"]')
      .trigger('click')

    expect(lastWrite(wrapper).gradients).toHaveLength(1)
  })

  it('填充正引着的那一条在渐变表上标出来', () => {
    const one = vecPrim({
      fill: { kind: 'gradient', id: 'g1' },
      gradients: [
        {
          kind: 'linear',
          id: 'g1',
          stops: [{ id: 's1', color: 'red', at: 0 }],
        },
      ],
    })

    expect(mountFields(one).text()).toContain('填充正引着它')
  })
})

describe('基类', () => {
  it('基类那一段的改动连着矢量自己的字段一起交出去', async () => {
    const wrapper = mountFields(vecPrim({ stretch: true }))

    await wrapper.find('[data-test="base-z"]').setValue('2')

    const next = lastWrite(wrapper)
    expect(next.z).toBe(2)
    expect(next.stretch).toBe(true)
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountFields()

    await wrapper.find('[data-test="base-z"]').trigger('focusout')

    expect((wrapper.emitted('blur') ?? []).length).toBeGreaterThan(0)
  })
})
