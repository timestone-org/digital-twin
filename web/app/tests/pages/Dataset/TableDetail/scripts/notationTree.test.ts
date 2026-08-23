/**
 * @fileoverview 记号树取字段助手的契约：任何形状都只降级不抛错。
 *
 * ⚠ 这一层是白屏的唯一防线。后端加一种新记号、或者某个节点少了个子字段，
 * 递归下去撞上 `undefined.t` 就是一个 TypeError，把整个列表单弹窗打黑
 * （docs/DATASET_DESIGN.md §5.9）。
 */
import { describe, expect, it } from 'vitest'

import {
  asNode,
  nodeChild,
  nodeKind,
  nodeNumber,
  nodeSlots,
  nodeText,
} from '@/pages/Dataset/TableDetail/scripts/notationTree'

describe('收成节点', () => {
  it('有字符串 t 才算一个可分派的节点', () => {
    expect(asNode({ t: 'num', v: '3' })).toEqual({ t: 'num', v: '3' })
  })

  const STRANGERS: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['裸字符串', 'num'],
    ['数字', 42],
    ['数组', [{ t: 'num' }]],
    ['没有 t', { v: '3' }],
    ['t 不是字符串', { t: 7 }],
  ]

  it.each(STRANGERS)('认不出的一律给 null：%s', (_name, value) => {
    expect(asNode(value)).toBeNull()
    expect(nodeKind(value)).toBe('')
  })
})

describe('取字段', () => {
  const node = asNode({ t: 'agg', sym: 'Σ', n: 3, x: { t: 'num', v: '1' } })

  it('字符串字段读不到时给空串', () => {
    expect(nodeText(node, 'sym')).toBe('Σ')
    expect(nodeText(node, 'label')).toBe('')
    expect(nodeText(null, 'sym')).toBe('')
  })

  it('数字字段读不到时给缺省值', () => {
    expect(nodeNumber(node, 'n', 1)).toBe(3)
    expect(nodeNumber(node, 'missing', 1)).toBe(1)
    expect(nodeNumber(asNode({ t: 'prev', n: 'x' }), 'n', 1)).toBe(1)
  })

  it('子节点位读不到时给 null，渲染器据此画占位', () => {
    expect(nodeChild(node, 'x')).toEqual({ t: 'num', v: '1' })
    expect(nodeChild(node, 'y')).toBeNull()
    expect(nodeChild(null, 'x')).toBeNull()
  })
})

describe('子节点数组', () => {
  it('带上位次：记号树有序，第几档就是第几档', () => {
    const node = asNode({ t: 'fn', args: [{ t: 'num' }, { t: 'col' }] })
    expect(nodeSlots(node, 'args')).toEqual([
      { at: 0, node: { t: 'num' } },
      { at: 1, node: { t: 'col' } },
    ])
  })

  it('不是数组就给空表，不抛错', () => {
    expect(nodeSlots(asNode({ t: 'fn', args: 'oops' }), 'args')).toEqual([])
    expect(nodeSlots(asNode({ t: 'fn' }), 'args')).toEqual([])
  })

  it('数组里的非节点原样带过去，由渲染器自己降级', () => {
    const node = asNode({ t: 'fn', args: [null, 3] })
    expect(nodeSlots(node, 'args')).toEqual([
      { at: 0, node: null },
      { at: 1, node: 3 },
    ])
  })
})
