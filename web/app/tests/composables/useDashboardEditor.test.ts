/**
 * @fileoverview 契约：草稿状态按引用判脏、改动记进撤销栈、换选中项关掉合并窗口，
 * 换基线时历史与脏标记一起归零。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { setConfigValue, setVisible } from '@/features/dashboard/editorDoc'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
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
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function editorWith(nodes: DashboardNodePayload[]) {
  const editor = useDashboardEditor(() => MANIFEST)
  editor.reset(nodes)
  return editor
}

describe('基线与脏标记', () => {
  it('刚换过基线时不脏', () => {
    const editor = editorWith([node('a')])

    expect(editor.isDirty.value).toBe(false)
  })

  it('一次真改动就置脏，换回基线后归零', () => {
    const editor = editorWith([node('a')])

    editor.apply((nodes) => setVisible(nodes, 'a', false))
    expect(editor.isDirty.value).toBe(true)

    editor.reset(editor.nodes.value)
    expect(editor.isDirty.value).toBe(false)
  })

  it('没改动的一次 apply 不置脏也不记历史', () => {
    const editor = editorWith([node('a')])

    editor.apply((nodes) => [...nodes])

    expect(editor.isDirty.value).toBe(false)
    expect(editor.canUndo.value).toBe(false)
  })
})

describe('选中', () => {
  it('选中的节点跟着当前草稿走', () => {
    const editor = editorWith([node('a'), node('b', { zIndex: 1 })])

    editor.select('b')

    expect(editor.selected.value?.id).toBe('b')
  })

  it('换基线后选中的节点没了就清掉选中', () => {
    const editor = editorWith([node('a')])
    editor.select('a')

    editor.reset([node('b')])

    expect(editor.selectedId.value).toBeNull()
  })

  it('换选中项会关掉合并窗口，两个节点的输入不会并成一笔', () => {
    const editor = editorWith([node('a'), node('b')])

    editor.select('a')
    editor.apply((nodes) => setConfigValue(nodes, 'a', ['t'], '甲'), 'a:t')
    editor.select('b')
    editor.apply((nodes) => setConfigValue(nodes, 'b', ['t'], '乙'), 'a:t')

    editor.undo()

    expect(
      editor.nodes.value.find((item) => item.id === 'b')?.configJson.t,
    ).toBeUndefined()
    expect(
      editor.nodes.value.find((item) => item.id === 'a')?.configJson.t,
    ).toBe('甲')
  })
})

describe('排版', () => {
  it('节点表一变，排版跟着重算', () => {
    const editor = editorWith([node('a')])

    expect(editor.layout.value.frames).toHaveLength(1)

    editor.apply((nodes) => [...nodes, node('b')])

    expect(editor.layout.value.frames.map((frame) => frame.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('节点表始终按 (parentId, zIndex, id) 定序', () => {
    const editor = editorWith([
      node('b', { zIndex: 2 }),
      node('a', { zIndex: 1 }),
    ])

    expect(editor.nodes.value.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('多选', () => {
  it('单选清掉其余，toggle 累积且末位是主选中', () => {
    const editor = editorWith([node('a'), node('b'), node('c')])

    editor.select('a')
    editor.toggleSelect('b')
    expect(editor.selectedIds.value).toEqual(['a', 'b'])
    expect(editor.selectedId.value).toBe('b')

    editor.toggleSelect('a')
    expect(editor.selectedIds.value).toEqual(['b'])

    editor.select('c')
    expect(editor.selectedIds.value).toEqual(['c'])
  })

  it('setSelection 剔除不存在的 id 并去重', () => {
    const editor = editorWith([node('a'), node('b')])

    editor.setSelection(['a', 'ghost', 'b', 'a'])

    expect(editor.selectedIds.value).toEqual(['a', 'b'])
    expect(editor.selectedNodes.value.map((item) => item.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('删掉节点后选中集自动收敛', () => {
    const editor = editorWith([node('a'), node('b')])

    editor.setSelection(['a', 'b'])
    editor.apply((nodes) => nodes.filter((item) => item.id !== 'b'))

    expect(editor.selectedIds.value).toEqual(['a'])
  })

  it('换基线时不存在的选中被清掉', () => {
    const editor = editorWith([node('a'), node('b')])

    editor.setSelection(['a', 'b'])
    editor.reset([node('b')])

    expect(editor.selectedIds.value).toEqual(['b'])
  })
})
