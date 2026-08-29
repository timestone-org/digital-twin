/**
 * @fileoverview 守自定义卡片页对配置做的那几笔：加减部件与格、上下移、改字段。
 *
 * ⚠ 两条边界最要紧：**删到最后一件时必须拦住**（一件都不剩的卡片是空白板，
 * 而用户多半只是想换一件），以及**一律返回新对象**（页面把 config 交给
 * `shallowRef` 持有，就地改的话预览与表单都不重算，用户看到的是「拖了没反应」）。
 */
import { describe, expect, it } from 'vitest'

import {
  CELLS_KEY,
  PARTS_KEY,
  addCell,
  addPart,
  cellsOf,
  movePart,
  partKindAt,
  partsOf,
  removeCell,
  removePart,
  setRowField,
} from '@/pages/CardEditor/scripts/cardDraft'

function config() {
  return {
    [PARTS_KEY]: [{ kind: 'label' }, { kind: 'value' }, { kind: 'meter' }],
    [CELLS_KEY]: [
      { label: '甲', unit: '℃' },
      { label: '乙', unit: '%' },
    ],
    title: '不该被动到',
  }
}

describe('部件', () => {
  it('加在末尾', () => {
    expect(partsOf(addPart(config(), 'divider')).at(-1)).toEqual({
      kind: 'divider',
    })
  })

  it('删中间一件，其余原序不动', () => {
    expect(partsOf(removePart(config(), 1)).map((one) => one.kind)).toEqual([
      'label',
      'meter',
    ])
  })

  // ⚠ 一件都不剩的卡片是空白板，看着像坏了
  it('只剩一件时删不动', () => {
    const only = { [PARTS_KEY]: [{ kind: 'label' }] }

    expect(removePart(only, 0)).toBe(only)
  })

  it('越界的下标原样返回，不悄悄删掉别的', () => {
    const before = config()

    expect(removePart(before, 9)).toBe(before)
  })

  it('上移与下移各挪一位', () => {
    expect(partsOf(movePart(config(), 1, -1)).map((one) => one.kind)).toEqual([
      'value',
      'label',
      'meter',
    ])
    expect(partsOf(movePart(config(), 1, 1)).map((one) => one.kind)).toEqual([
      'label',
      'meter',
      'value',
    ])
  })

  // ⚠ 绕回另一端在一列表里看着像「跳走了」
  it('到头了原样返回，不绕回另一端', () => {
    const before = config()

    expect(movePart(before, 0, -1)).toBe(before)
    expect(movePart(before, 2, 1)).toBe(before)
  })

  it('取某一件是哪一档', () => {
    expect(partKindAt(config(), 2)).toBe('meter')
    expect(partKindAt(config(), 9)).toBe('')
  })
})

describe('格', () => {
  it('加一格时名字按序号起，免得一排「未命名」分不清', () => {
    expect(cellsOf(addCell(config())).at(-1)?.label).toBe('点位 3')
  })

  it('删中间一格', () => {
    expect(cellsOf(removeCell(config(), 0)).map((one) => one.label)).toEqual([
      '乙',
    ])
  })

  it('只剩一格时删不动', () => {
    const only = { [CELLS_KEY]: [{ label: '甲' }] }

    expect(removeCell(only, 0)).toBe(only)
  })
})

describe('改字段', () => {
  it('只改那一行的那一个键', () => {
    const next = setRowField(config(), PARTS_KEY, 1, 'value-size', 24)

    expect(partsOf(next)[1]).toEqual({ kind: 'value', 'value-size': 24 })
    expect(partsOf(next)[0]).toEqual({ kind: 'label' })
  })

  it('行不存在时原样返回', () => {
    const before = config()

    expect(setRowField(before, PARTS_KEY, 9, 'x', 1)).toBe(before)
  })
})

describe('都返回新对象', () => {
  // ⚠ 就地改的话 `shallowRef` 认不出变化，预览与表单都不重算
  it('每一笔都换出新的 config，且不动别的键', () => {
    const before = config()
    for (const next of [
      addPart(before, 'divider'),
      removePart(before, 0),
      movePart(before, 0, 1),
      addCell(before),
      removeCell(before, 0),
      setRowField(before, PARTS_KEY, 0, 'label-size', 9),
    ]) {
      expect(next).not.toBe(before)
      expect(next.title).toBe('不该被动到')
    }
    expect(partsOf(before).map((one) => one.kind)).toEqual([
      'label',
      'value',
      'meter',
    ])
  })
})
