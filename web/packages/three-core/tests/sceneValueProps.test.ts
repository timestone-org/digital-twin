/**
 * @fileoverview 六路实时值的可选 prop 补齐。
 *
 * ⚠ 缺席的那一路必须换成同一个空引用：每次新建一个空对象，会让下游的 watch
 * 每帧都判成「变了」，一条绑定都没配的孪生模块也跟着空转重建覆盖层。
 */
import {
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
  EMPTY_PART_VALUES,
} from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { partFieldValuesOf, sceneValuesOf } from '../src/sceneValueProps'

describe('实时值 prop 的补齐', () => {
  it('一路都没给时六路各自是那一份稳定空引用', () => {
    expect(sceneValuesOf({})).toEqual({
      parts: EMPTY_PART_VALUES,
      anchors: EMPTY_ANCHOR_VALUES,
      arrows: EMPTY_ARROW_VALUES,
      panels: EMPTY_PANEL_VALUES,
      flows: EMPTY_FLOW_VALUES,
    })
  })

  it('两次调用给回同一批空引用，不每次新建对象', () => {
    expect(sceneValuesOf({}).parts).toBe(sceneValuesOf({}).parts)
  })

  it('给了的那一路原样带过去', () => {
    const parts = { p1: { value: 3 } }

    expect(sceneValuesOf({ values: { parts } }).parts).toBe(parts)
  })

  it('空表也算给过：不拿空引用顶掉它', () => {
    const empty = {}

    expect(sceneValuesOf({ values: { anchors: empty } }).anchors).toBe(empty)
  })
})

describe('详情字段那一路', () => {
  it('缺席时给同一个空引用', () => {
    expect(partFieldValuesOf({})).toBe(partFieldValuesOf({ values: {} }))
  })

  it('给了的原样带过去', () => {
    const fields = { 'p1::temp': { value: 7 } }

    expect(partFieldValuesOf({ values: { partFields: fields } })).toBe(fields)
  })
})
