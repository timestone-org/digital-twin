/**
 * @fileoverview 契约：五种几何各有各的编辑面，坐标口径换档只换口径不换数，
 * 画不出来的几何当场标红，画布取点的点序列写得进折线与路径。
 *
 * ⚠ 换坐标口径时静默换算会让图形在换档那一下整个跑掉，而每一处取值单看都对——
 * 这条用例钉住「只 emit 口径、一个数都不动」。
 * ⚠ 空 d 与少于两点的折线会被归一化整段丢掉：不标红的话，用户配好一段几何、存一次
 * 再读回来那一段凭空消失且零报错。
 * ⚠ 没人接的「取点」键按下去毫无反应，所以装配层不给 canPick 时这个键根本不出现。
 */
import { TWIN_2D_SHAPE_KINDS, TWIN_2D_VEC_COORDS } from '@dt/twin2d'
import type { Twin2dShape } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GeometryField from '@/pages/Twin2dEditor/components/fields/GeometryField.vue'

const PATH: Twin2dShape = { kind: 'path', d: 'M 0 0 L 8 8' }
const RECT: Twin2dShape = { kind: 'rect', x: 1, y: 2, w: 3, h: 4, rx: 0 }
const ELLIPSE: Twin2dShape = {
  kind: 'ellipse',
  cx: 0.5,
  cy: 0.5,
  rx: 0.5,
  ry: 0.25,
}
const LINE: Twin2dShape = { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }
const POLY: Twin2dShape = {
  kind: 'poly',
  points: [
    [0, 0],
    [1, 1],
  ],
  closed: false,
}

function mountField(shape: Twin2dShape, extra: Record<string, unknown> = {}) {
  return mount(GeometryField, { props: { modelValue: shape, ...extra } })
}

type Wrapper = ReturnType<typeof mountField>

function lastWrite(wrapper: Wrapper): Twin2dShape {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回几何')
  return events[events.length - 1]?.[0] as Twin2dShape
}

/** 按可见标签取那一个下拉——同一面里有两个，按序号取会跟着版式一起漂。 */
function selectBy(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有标着「${label}」的下拉`)
  return found
}

describe('五档几何', () => {
  it('五档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountField(PATH),
      '几何',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_SHAPE_KINDS,
    ])
  })

  // ⚠ 0 宽的矩形与空路径都等于什么都没画，用户只会以为换档没生效
  it('换档取的是看得见的初值', () => {
    const wrapper = mountField(PATH)

    selectBy(wrapper, '几何').vm.$emit('update:modelValue', 'rect')
    const shape = lastWrite(wrapper)

    expect(shape.kind === 'rect' ? shape.w : 0).toBeGreaterThan(0)
    expect(shape.kind === 'rect' ? shape.h : 0).toBeGreaterThan(0)
  })

  it('归一档的新几何按整只盒算，像素档按二十四像素算', () => {
    const unit = mountField(PATH, { coord: 'unit' })
    const px = mountField(PATH, { coord: 'px' })

    selectBy(unit, '几何').vm.$emit('update:modelValue', 'rect')
    selectBy(px, '几何').vm.$emit('update:modelValue', 'rect')

    expect(lastWrite(unit)).toMatchObject({ w: 1 })
    expect(lastWrite(px)).toMatchObject({ w: 24 })
  })

  it('换成折线时自带三个点且闭合', () => {
    const wrapper = mountField(PATH)

    selectBy(wrapper, '几何').vm.$emit('update:modelValue', 'poly')
    const shape = lastWrite(wrapper)

    expect(shape.kind === 'poly' ? shape.points : []).toHaveLength(3)
    expect(shape).toMatchObject({ closed: true })
  })

  it('换成路径时的 d 是提笔加一段连线', () => {
    const wrapper = mountField(RECT)

    selectBy(wrapper, '几何').vm.$emit('update:modelValue', 'path')

    expect(lastWrite(wrapper)).toEqual({ kind: 'path', d: 'M 0 0 L 1 1' })
  })

  it('换成同一档与认不出的档位都不写回', () => {
    const wrapper = mountField(RECT)

    selectBy(wrapper, '几何').vm.$emit('update:modelValue', 'rect')
    selectBy(wrapper, '几何').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('坐标口径', () => {
  it('不给这一档时面板上就没有它', () => {
    expect(mountField(RECT).find('[data-test="geometry-coord"]').exists()).toBe(
      false,
    )
  })

  it('两档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountField(RECT, { coord: 'unit' }),
      '坐标口径',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_VEC_COORDS,
    ])
  })

  // ⚠ 静默换算会让图形在换档那一下整个跑掉，而每一处取值单看都对
  it('换口径只换口径，一个数都不动', () => {
    const wrapper = mountField(RECT, { coord: 'unit' })

    selectBy(wrapper, '坐标口径').vm.$emit('update:modelValue', 'px')

    expect(wrapper.emitted('update:coord')).toEqual([['px']])
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('换成同一档与认不出的档位都不写回', () => {
    const wrapper = mountField(RECT, { coord: 'px' })

    selectBy(wrapper, '坐标口径').vm.$emit('update:modelValue', 'px')
    selectBy(wrapper, '坐标口径').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:coord')).toBeUndefined()
  })

  it('面板上写明这是换坐标系', () => {
    const wrapper = mountField(RECT, { coord: 'unit' })

    expect(wrapper.find('[data-test="geometry-coord-hint"]').text()).toContain(
      '换的是坐标系',
    )
  })
})

describe('路径与折线', () => {
  // ⚠ 落盘那一步会 trim，在这里 trim 再回填 DOM，空格就永远打不出来
  it('路径的 d 原样写回，不去空白', async () => {
    const wrapper = mountField(PATH)

    await wrapper.find('[data-test="geometry-d"]').setValue('M 0 0 ')

    expect(lastWrite(wrapper)).toEqual({ kind: 'path', d: 'M 0 0 ' })
  })

  it('空 d 当场标红', () => {
    const wrapper = mountField({ kind: 'path', d: '  ' })

    expect(wrapper.text()).toContain('整段丢掉')
  })

  it('折线点逐键解析后写回', async () => {
    const wrapper = mountField(POLY)

    await wrapper.find('[data-test="geometry-points"]').setValue('0,0 2,2 4,0')

    expect(lastWrite(wrapper)).toEqual({
      kind: 'poly',
      points: [
        [0, 0],
        [2, 2],
        [4, 0],
      ],
      closed: false,
    })
  })

  // ⚠ 不足两点的折线会被整段丢掉，所以不写回也不让它悄悄过去
  it('点不够两个时不写回且当场标红', async () => {
    const wrapper = mountField(POLY)

    await wrapper.find('[data-test="geometry-points"]').setValue('0,0')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('至少两个点')
  })

  it('框里留用户敲的原文，失焦才拨回文档里的值', async () => {
    const wrapper = mountField(POLY)
    const box = wrapper.find('[data-test="geometry-points"]')

    await box.setValue('0,0 2,2 ')
    expect((box.element as HTMLInputElement).value).toBe('0,0 2,2 ')

    await box.trigger('focusout')
    expect((box.element as HTMLInputElement).value).toBe('0,0 1,1')
  })

  it('闭合是一个开关，点串留着', async () => {
    const wrapper = mountField(POLY)

    await wrapper.find('[data-test="geometry-closed"] input').setValue(true)

    expect(lastWrite(wrapper)).toEqual({ ...POLY, closed: true })
  })

  it('失焦时回抛一次 blur 收段', async () => {
    const wrapper = mountField(POLY)

    await wrapper.find('[data-test="geometry-points"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})

describe('数字格子', () => {
  it('矩形五格各写各的', async () => {
    const wrapper = mountField(RECT)

    await wrapper.find('[data-test="geometry-w"]').setValue('9')

    expect(lastWrite(wrapper)).toEqual({ ...RECT, w: 9 })
  })

  it('椭圆四格各写各的', async () => {
    const wrapper = mountField(ELLIPSE)

    await wrapper.find('[data-test="geometry-ry"]').setValue('0.75')

    expect(lastWrite(wrapper)).toEqual({ ...ELLIPSE, ry: 0.75 })
  })

  it('线段四格各写各的', async () => {
    const wrapper = mountField(LINE)

    await wrapper.find('[data-test="geometry-x2"]').setValue('3')

    expect(lastWrite(wrapper)).toEqual({ ...LINE, x2: 3 })
  })

  // ⚠ 空的宽高会让整段几何被判非法，所以框清空时一个字都不写回
  it('框清空时不写回', async () => {
    const wrapper = mountField(RECT)

    await wrapper.find('[data-test="geometry-w"]').setValue('')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('路径与折线两档没有数字格子', () => {
    expect(mountField(PATH).find('[data-test="geometry-x"]').exists()).toBe(
      false,
    )
    expect(mountField(POLY).find('[data-test="geometry-w"]').exists()).toBe(
      false,
    )
  })
})

describe('在画布上取点', () => {
  it('装配层没说接得住时这个键根本不出现', () => {
    expect(mountField(POLY).find('[data-test="geometry-pick"]').exists()).toBe(
      false,
    )
  })

  it('三种画不了折点的几何上也没有这个键', () => {
    const wrapper = mountField(RECT, { canPick: true })

    expect(wrapper.find('[data-test="geometry-pick"]').exists()).toBe(false)
  })

  it('按下去只出请求，带着这一段几何是哪一种', async () => {
    const wrapper = mountField(POLY, { canPick: true })

    await wrapper.find('[data-test="geometry-pick"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([['poly']])
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('路径那一档请求的目标是路径', async () => {
    const wrapper = mountField(PATH, { canPick: true })

    await wrapper.find('[data-test="geometry-pick"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([['path']])
  })

  it('取点中改成结束键，并数着已经取了几个点', async () => {
    const wrapper = mountField(POLY, { canPick: true, picked: [] })

    await wrapper.setProps({ picked: [[1, 1]] })

    expect(wrapper.find('[data-test="geometry-pick"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="geometry-pick-end"]').text()).toContain(
      '已取 1 点',
    )
  })

  it('结束键只出请求，不碰几何', async () => {
    const wrapper = mountField(POLY, { canPick: true, picked: [] })

    await wrapper.find('[data-test="geometry-pick-end"]').trigger('click')

    expect(wrapper.emitted('pickEnd')).toHaveLength(1)
  })

  it('取回来的点够两个就写进折线', async () => {
    const wrapper = mountField(POLY, { canPick: true, picked: [] })

    await wrapper.setProps({
      picked: [
        [0, 0],
        [3, 4],
      ],
    })

    expect(lastWrite(wrapper)).toEqual({
      kind: 'poly',
      points: [
        [0, 0],
        [3, 4],
      ],
      closed: false,
    })
  })

  it('取回来的点在路径那一档拼成提笔加连线', async () => {
    const wrapper = mountField(PATH, { canPick: true, picked: [] })

    await wrapper.setProps({
      picked: [
        [0, 0],
        [3, 4],
      ],
    })

    expect(lastWrite(wrapper)).toEqual({ kind: 'path', d: 'M 0 0 L 3 4' })
  })

  it('只取到一个点时一个字都不写回', async () => {
    const wrapper = mountField(POLY, { canPick: true, picked: [] })

    await wrapper.setProps({ picked: [[0, 0]] })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  // ⚠ 取点是一段连续输入，画布退出取点模式就是这一段的收尾
  it('画布退出取点模式时收一次段', async () => {
    const wrapper = mountField(POLY, { canPick: true, picked: [] })

    await wrapper.setProps({ picked: null })

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
