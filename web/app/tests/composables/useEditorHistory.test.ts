/**
 * @fileoverview 契约：结构性改动立即成一笔、连续输入按合并键并成一笔，
 * 且**撤销前关掉合并窗口**——不关的话撤销之后接着输入会并进被撤销的状态，
 * 等于把刚撤掉的那一步又悄悄改了回去。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload } from '@dt/contracts'

import { useEditorHistory } from '@/composables/useEditorHistory'

function snapshot(title: string): readonly DashboardNodePayload[] {
  return [
    {
      id: 'n1',
      dashboardId: 'd1',
      parentId: null,
      clientKey: null,
      moduleType: 'demo',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      zIndex: 0,
      isVisible: true,
      configJson: { title },
      createdAt: '',
      updatedAt: '',
      bindings: [],
    },
  ]
}

function titleOf(nodes: readonly DashboardNodePayload[]): unknown {
  return nodes[0]?.configJson.title
}

describe('结构性改动', () => {
  it('每一笔各成一步，撤销回到上一步', () => {
    const history = useEditorHistory(snapshot('零'))

    history.commit(snapshot('一'))
    history.commit(snapshot('二'))

    expect(history.canUndo.value).toBe(true)
    history.undo()
    expect(titleOf(history.present.value)).toBe('一')
    history.undo()
    expect(titleOf(history.present.value)).toBe('零')
    expect(history.canUndo.value).toBe(false)
  })

  it('同一份引用再记一次不算一步', () => {
    const initial = snapshot('零')
    const history = useEditorHistory(initial)

    history.commit(initial)

    expect(history.canUndo.value).toBe(false)
  })
})

describe('连续输入的合并', () => {
  it('同一个合并键的几笔并成一笔，一次撤销回到输入之前', () => {
    const history = useEditorHistory(snapshot(''))

    history.commit(snapshot('北'), 'n1:title')
    history.commit(snapshot('北京'), 'n1:title')
    history.commit(snapshot('北京市'), 'n1:title')

    expect(titleOf(history.present.value)).toBe('北京市')
    history.undo()
    expect(titleOf(history.present.value)).toBe('')
  })

  it('换一个合并键就另起一步', () => {
    const history = useEditorHistory(snapshot(''))

    history.commit(snapshot('甲'), 'n1:title')
    history.commit(snapshot('乙'), 'n2:title')

    history.undo()
    expect(titleOf(history.present.value)).toBe('甲')
  })

  it('flush 之后同一个合并键也另起一步', () => {
    const history = useEditorHistory(snapshot(''))

    history.commit(snapshot('甲'), 'n1:title')
    history.flush()
    history.commit(snapshot('甲乙'), 'n1:title')

    history.undo()
    expect(titleOf(history.present.value)).toBe('甲')
  })

  it('撤销先关掉合并窗口：撤销之后的输入另起一步，不会并进被撤销的那一笔', () => {
    const history = useEditorHistory(snapshot('零'))

    history.commit(snapshot('一'), 'n1:title')
    history.undo()
    expect(titleOf(history.present.value)).toBe('零')

    history.commit(snapshot('二'), 'n1:title')
    history.undo()

    expect(titleOf(history.present.value)).toBe('零')
  })
})

describe('重做', () => {
  it('撤销之后能重做回去', () => {
    const history = useEditorHistory(snapshot('零'))

    history.commit(snapshot('一'))
    history.undo()
    expect(history.canRedo.value).toBe(true)
    history.redo()

    expect(titleOf(history.present.value)).toBe('一')
    expect(history.canRedo.value).toBe(false)
  })

  it('新的一笔清空重做栈', () => {
    const history = useEditorHistory(snapshot('零'))

    history.commit(snapshot('一'))
    history.undo()
    history.commit(snapshot('二'))

    expect(history.canRedo.value).toBe(false)
  })

  it('重做栈空时按重做没有任何变化', () => {
    const history = useEditorHistory(snapshot('零'))

    history.redo()

    expect(titleOf(history.present.value)).toBe('零')
  })
})

describe('栈深与重置', () => {
  it('超过上限时最早的一笔被挤掉', () => {
    const history = useEditorHistory(snapshot('0'), 2)

    history.commit(snapshot('1'))
    history.commit(snapshot('2'))
    history.commit(snapshot('3'))
    history.undo()
    history.undo()

    expect(titleOf(history.present.value)).toBe('1')
    expect(history.canUndo.value).toBe(false)
  })

  it('reset 丢掉全部历史并换掉基线', () => {
    const history = useEditorHistory(snapshot('零'))

    history.commit(snapshot('一'))
    history.reset(snapshot('新'))

    expect(titleOf(history.present.value)).toBe('新')
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
  })
})
