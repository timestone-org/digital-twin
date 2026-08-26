/**
 * @fileoverview 契约：选中态是对象，比较必须走 `isSameTwin2dSelection`，
 * 而五类实体的显示名与 `Twin2dConfig` 上的数组字段名一一对应。
 *
 * ⚠ `===` 比两个内容相同的选中恒为 false：大纲高亮与检查器分派各比各的，
 * 就会出现「树里选中了 A、检查器画的是 B」，而两边都不报错。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_ENTITY_LABELS,
  TWIN_2D_SELECT_CANVAS,
  isSameTwin2dSelection,
} from '@/pages/Twin2dEditor/scripts/types'

describe('实体显示名', () => {
  it('五类实体各有一个名字', () => {
    expect(Object.keys(TWIN_2D_ENTITY_LABELS)).toEqual([
      'nodes',
      'edges',
      'marks',
      'styles',
      'edgeStyles',
    ])
  })

  it('名字都不为空，否则大纲上会出现一段没有标题的分组', () => {
    for (const label of Object.values(TWIN_2D_ENTITY_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('选中比较', () => {
  it('两边都没有选中算同一个', () => {
    expect(isSameTwin2dSelection(null, null)).toBe(true)
  })

  it('一边没有选中就不是同一个', () => {
    expect(isSameTwin2dSelection(null, TWIN_2D_SELECT_CANVAS)).toBe(false)
    expect(isSameTwin2dSelection(TWIN_2D_SELECT_CANVAS, null)).toBe(false)
  })

  it('画布这一段没有 id，两份画布选中算同一个', () => {
    expect(isSameTwin2dSelection({ kind: 'canvas' }, { kind: 'canvas' })).toBe(
      true,
    )
  })

  it('同一类同一个 id 算同一个', () => {
    expect(
      isSameTwin2dSelection(
        { kind: 'nodes', id: 'n1' },
        { kind: 'nodes', id: 'n1' },
      ),
    ).toBe(true)
  })

  it('同一类不同 id 不是同一个', () => {
    expect(
      isSameTwin2dSelection(
        { kind: 'nodes', id: 'n1' },
        { kind: 'nodes', id: 'n2' },
      ),
    ).toBe(false)
  })

  // ⚠ 节点与连线可以撞同一个 id：只比 id 会让选中一条线时高亮到一个节点
  it('id 相同但类不同不是同一个', () => {
    expect(
      isSameTwin2dSelection(
        { kind: 'nodes', id: 'x' },
        { kind: 'edges', id: 'x' },
      ),
    ).toBe(false)
  })

  it('画布与实体不是同一个', () => {
    expect(
      isSameTwin2dSelection(TWIN_2D_SELECT_CANVAS, { kind: 'nodes', id: 'x' }),
    ).toBe(false)
  })
})
