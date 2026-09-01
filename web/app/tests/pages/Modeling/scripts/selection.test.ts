/**
 * @fileoverview 选中状态：节点与边互斥、加选、以及图变小之后的剪枝。
 */
import { describe, expect, it } from 'vitest'

import { useCanvasSelection } from '@/pages/Modeling/Canvas/scripts/useCanvasSelection'
import { stateOf } from '@/pages/Modeling/Canvas/scripts/nodeState'

describe('画布上的选中', () => {
  it('选一个节点会清掉先前选中的边', () => {
    const selection = useCanvasSelection()
    selection.select({ kind: 'edge', id: 'e1' })

    selection.select({ kind: 'node', id: 'n1' })

    expect(selection.selectedNodeIds.value).toEqual(['n1'])
    expect(selection.selectedEdgeIds.value).toEqual([])
  })

  it('加选同一个再点一次就取消它', () => {
    const selection = useCanvasSelection()

    selection.toggle({ kind: 'node', id: 'n1' })
    selection.toggle({ kind: 'node', id: 'n2' })
    selection.toggle({ kind: 'node', id: 'n1' })

    expect(selection.selectedNodeIds.value).toEqual(['n2'])
  })

  it('框选整批替换掉原来的选中', () => {
    const selection = useCanvasSelection()
    selection.select({ kind: 'node', id: 'n9' })

    selection.selectNodes(['n1', 'n2'])

    expect(selection.selectedNodeIds.value).toEqual(['n1', 'n2'])
  })

  it('删掉的东西要从选中集里剪掉，不留下选不中的幽灵', () => {
    const selection = useCanvasSelection()
    selection.selectNodes(['n1', 'n2'])

    selection.prune(['n2'], [])

    expect(selection.selectedNodeIds.value).toEqual(['n2'])
    expect(selection.hasSelection.value).toBe(true)
  })

  it('清空之后什么都没选中', () => {
    const selection = useCanvasSelection()
    selection.selectNodes(['n1'])

    selection.clear()

    expect(selection.hasSelection.value).toBe(false)
    expect(selection.isNodeSelected('n1')).toBe(false)
  })
})

describe('后端状态映射到画布四态', () => {
  it('取消中仍然按「在跑」显示——那一步还没停下来', () => {
    expect(stateOf('cancelling')).toBe('running')
  })

  it('已取消与被跳过在画布上是同一种观感', () => {
    expect(stateOf('cancelled')).toBe('skipped')
    expect(stateOf('skipped')).toBe('skipped')
  })

  it('没跑过与认不出的状态都当「待运行」', () => {
    expect(stateOf(undefined)).toBe('idle')
    expect(stateOf('pending')).toBe('idle')
  })

  it('成功与失败各自成一档', () => {
    expect(stateOf('succeeded')).toBe('succeeded')
    expect(stateOf('failed')).toBe('failed')
  })
})
