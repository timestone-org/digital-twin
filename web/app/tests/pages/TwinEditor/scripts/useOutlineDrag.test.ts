/**
 * @fileoverview 锁住拖行入夹状态机的落点规则：只认同段（同 kind）的夹、
 * 拖回自己所在的夹是空操作，合法落点才 preventDefault，drop 后状态清零。
 */
import { describe, expect, it, vi } from 'vitest'

import { useOutlineDrag } from '@/pages/TwinEditor/scripts/useOutlineDrag'
import type {
  TwinOutlineFolderView,
  TwinOutlineRow,
} from '@/pages/TwinEditor/scripts/outlineNodes'

function row(over: Partial<TwinOutlineRow> = {}): TwinOutlineRow {
  return {
    key: 'anchors:0:a1',
    id: 'a1',
    kind: 'anchors',
    index: 1,
    label: '进水温度',
    meta: '',
    visible: true,
    flagged: false,
    canMoveUp: false,
    canMoveDown: false,
    ...over,
  }
}

function folder(
  over: Partial<TwinOutlineFolderView> = {},
): TwinOutlineFolderView {
  return {
    key: 'folder:f1',
    id: 'f1',
    kind: 'anchors',
    label: '温度组',
    rows: [],
    ...over,
  }
}

function dragEventOf(): {
  event: DragEvent
  prevent: ReturnType<typeof vi.fn>
} {
  const event = new Event('dragover') as DragEvent
  const prevent = vi.fn()
  event.preventDefault = prevent
  return { event, prevent }
}

describe('悬停', () => {
  it('同段的夹是合法落点：preventDefault 并亮环', () => {
    const drag = useOutlineDrag(vi.fn())
    const { event, prevent } = dragEventOf()

    drag.start(row(), null)
    drag.over(folder(), event)

    expect(prevent).toHaveBeenCalled()
    expect(drag.dropFolderId.value).toBe('f1')
  })

  it('没在拖时悬停不亮环', () => {
    const drag = useOutlineDrag(vi.fn())
    const { event, prevent } = dragEventOf()

    drag.over(folder(), event)

    expect(prevent).not.toHaveBeenCalled()
    expect(drag.dropFolderId.value).toBeNull()
  })

  it('别的段的夹不是落点', () => {
    const drag = useOutlineDrag(vi.fn())
    const { event, prevent } = dragEventOf()

    drag.start(row({ kind: 'parts', id: 'p1' }), null)
    drag.over(folder(), event)

    expect(prevent).not.toHaveBeenCalled()
    expect(drag.dropFolderId.value).toBeNull()
  })

  it('拖回自己所在的夹是空操作，不亮环', () => {
    const drag = useOutlineDrag(vi.fn())
    const { event, prevent } = dragEventOf()

    drag.start(row(), 'f1')
    drag.over(folder(), event)

    expect(prevent).not.toHaveBeenCalled()
  })
})

describe('落下', () => {
  it('合法落点回调夹 id 与行实体 id，状态清零', () => {
    const onDrop = vi.fn()
    const drag = useOutlineDrag(onDrop)

    drag.start(row(), null)
    drag.over(folder(), dragEventOf().event)
    drag.drop(folder())

    expect(onDrop).toHaveBeenCalledWith('f1', 'a1')
    expect(drag.dropFolderId.value).toBeNull()
  })

  it('从一个夹拖进另一个夹也落得下', () => {
    const onDrop = vi.fn()
    const drag = useOutlineDrag(onDrop)

    drag.start(row(), 'f1')
    drag.drop(folder({ key: 'folder:f2', id: 'f2' }))

    expect(onDrop).toHaveBeenCalledWith('f2', 'a1')
  })

  it('拖回自己所在的夹不回调', () => {
    const onDrop = vi.fn()
    const drag = useOutlineDrag(onDrop)

    drag.start(row(), 'f1')
    drag.drop(folder())

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('drop 之后再 drop 不借用上一次的起点', () => {
    const onDrop = vi.fn()
    const drag = useOutlineDrag(onDrop)

    drag.start(row(), null)
    drag.drop(folder())
    drag.drop(folder())

    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('dragend 清干净拖拽态与高亮', () => {
    const onDrop = vi.fn()
    const drag = useOutlineDrag(onDrop)

    drag.start(row(), null)
    drag.over(folder(), dragEventOf().event)
    drag.end()

    expect(drag.dropFolderId.value).toBeNull()
    drag.drop(folder())
    expect(onDrop).not.toHaveBeenCalled()
  })
})
