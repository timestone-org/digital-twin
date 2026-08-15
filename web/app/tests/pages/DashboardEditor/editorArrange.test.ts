/**
 * @fileoverview 排布动作契约：同父守卫、整理跳过钉位与子层、
 * 粘贴选中新节点且根钳回边界、再制不动剪贴板。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { __resetClipboard } from '@/features/dashboard/editorClipboard'
import {
  createArrangeActions,
  type ArrangeActions,
} from '@/pages/DashboardEditor/editorArrange'

const PLAIN: ModuleManifest = {
  type: 'text-block',
  displayName: '文本块',
  category: '装饰',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}
const CONTAINER: ModuleManifest = {
  ...PLAIN,
  type: 'container',
  displayName: '容器',
  isContainer: true,
}
const HEADER: ModuleManifest = {
  ...PLAIN,
  type: 'header',
  displayName: '页头',
  region: 'header',
}

const MANIFESTS: Record<string, ModuleManifest> = {
  'text-block': PLAIN,
  container: CONTAINER,
  header: HEADER,
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd-1',
    parentId: null,
    clientKey: null,
    moduleType: 'text-block',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function setup(nodes: DashboardNodePayload[]): {
  editor: ReturnType<typeof useDashboardEditor>
  actions: ArrangeActions
} {
  const editor = useDashboardEditor((type) => MANIFESTS[type])
  editor.reset(nodes)
  const actions = createArrangeActions({
    editor,
    getManifest: (type) => MANIFESTS[type],
    design: () => ({ width: 1000, height: 800 }),
    steps: () => ({ x: 100, y: 100 }),
    dashboardId: () => 'd-1',
  })
  return { editor, actions }
}

function byId(
  editor: ReturnType<typeof useDashboardEditor>,
  id: string,
): DashboardNodePayload | undefined {
  return editor.nodes.value.find((item) => item.id === id)
}

afterEach(__resetClipboard)

describe('同父守卫', () => {
  it('跨父选中时对齐不亮灯也不动', () => {
    const { editor, actions } = setup([
      node('c', { moduleType: 'container', zIndex: 0 }),
      node('c1', { parentId: 'c', x: 5 }),
      node('t', { zIndex: 1, x: 300 }),
    ])
    editor.setSelection(['c1', 't'])

    expect(actions.alignReady()).toBe(false)
    actions.alignSelected('left')

    expect(byId(editor, 'c1')?.x).toBe(5)
    expect(byId(editor, 't')?.x).toBe(300)
  })

  it('同父两个可对齐，三个才可分布', () => {
    const { editor, actions } = setup([
      node('a', { zIndex: 0 }),
      node('b', { zIndex: 1, x: 200 }),
    ])
    editor.setSelection(['a', 'b'])

    expect(actions.alignReady()).toBe(true)
    expect(actions.distributeReady()).toBe(false)

    actions.alignSelected('left')
    expect(byId(editor, 'b')?.x).toBe(0)
  })
})

describe('逐层挪', () => {
  function zOf(
    editor: ReturnType<typeof useDashboardEditor>,
    id: string,
  ): number {
    return byId(editor, id)?.zIndex ?? -1
  }

  it('单选上移一层：只与紧邻的那个换位', () => {
    const { editor, actions } = setup([
      node('a', { zIndex: 0 }),
      node('b', { zIndex: 1 }),
      node('c', { zIndex: 2 }),
    ])
    editor.setSelection(['a'])

    actions.bringSelectedForward()

    expect([zOf(editor, 'a'), zOf(editor, 'b'), zOf(editor, 'c')]).toEqual([
      1, 0, 2,
    ])
  })

  it('多选一起挪：两个选中的都往上走一格，没互相顶掉', () => {
    const { editor, actions } = setup([
      node('a', { zIndex: 0 }),
      node('b', { zIndex: 1 }),
      node('c', { zIndex: 2 }),
      node('d', { zIndex: 3 }),
    ])
    editor.setSelection(['a', 'b'])

    actions.bringSelectedForward()

    expect([
      zOf(editor, 'a'),
      zOf(editor, 'b'),
      zOf(editor, 'c'),
      zOf(editor, 'd'),
    ]).toEqual([1, 2, 0, 3])
  })

  it('到底了就不动，也不记撤销', () => {
    const { editor, actions } = setup([
      node('a', { zIndex: 0 }),
      node('b', { zIndex: 1 }),
    ])
    editor.setSelection(['a'])

    actions.sendSelectedBackward()

    expect([zOf(editor, 'a'), zOf(editor, 'b')]).toEqual([0, 1])
    expect(editor.canUndo.value).toBe(false)
  })
})

describe('整理', () => {
  it('只动顶层普通节点：钉位与容器子节点原样', () => {
    const { editor, actions } = setup([
      node('h', { moduleType: 'header', zIndex: 0 }),
      node('a', { zIndex: 1, x: 50, y: 60 }),
      node('b', { zIndex: 2, x: 60, y: 70 }),
      node('c', { moduleType: 'container', zIndex: 3, x: 500, y: 500 }),
      node('c1', { parentId: 'c', x: 33 }),
    ])
    const headerBefore = byId(editor, 'h')
    const childBefore = byId(editor, 'c1')

    actions.tidyTopLevel()

    expect(byId(editor, 'h')).toBe(headerBefore)
    expect(byId(editor, 'c1')).toBe(childBefore)
    const a = byId(editor, 'a')
    const b = byId(editor, 'b')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (a !== undefined && b !== undefined) {
      const overlap =
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      expect(overlap).toBe(false)
    }
  })
})

describe('复制粘贴', () => {
  it('粘贴选中新节点、根带偏移、原节点不动', () => {
    const { editor, actions } = setup([node('a', { x: 100, y: 100 })])
    editor.select('a')

    expect(actions.copySelected()).toBe(true)
    editor.select(null)
    expect(actions.pasteClipboard()).toBe(true)

    expect(editor.nodes.value).toHaveLength(2)
    const pastedId = editor.selectedIds.value[0]
    expect(pastedId).toBeDefined()
    expect(pastedId).not.toBe('a')
    const pasted = byId(editor, pastedId ?? '')
    expect(pasted?.x).toBe(116)
    expect(byId(editor, 'a')?.x).toBe(100)
  })

  it('选中容器时粘进容器', () => {
    const { editor, actions } = setup([
      node('a', { x: 100, zIndex: 0 }),
      node('c', { moduleType: 'container', zIndex: 1 }),
    ])
    editor.select('a')
    actions.copySelected()
    editor.select('c')
    actions.pasteClipboard()

    const pasted = editor.nodes.value.find((item) => item.parentId === 'c')
    expect(pasted).toBeDefined()
  })

  it('再制不动剪贴板', () => {
    const { editor, actions } = setup([
      node('a', { x: 100 }),
      node('b', { x: 300, zIndex: 1 }),
    ])
    editor.select('a')
    actions.copySelected()
    editor.select('b')
    actions.duplicateSelected()

    // 再制出的是 b 的副本；剪贴板里仍是 a
    expect(editor.nodes.value).toHaveLength(3)
    editor.select(null)
    actions.pasteClipboard()
    const xs = editor.nodes.value.map((item) => item.x).sort((l, r) => l - r)
    // a=100、b=300、b 副本=316、a 副本=116
    expect(xs).toEqual([100, 116, 300, 316])
  })

  it('钉位单例复制不进剪贴板', () => {
    const { editor, actions } = setup([node('h', { moduleType: 'header' })])
    editor.select('h')
    expect(actions.copySelected()).toBe(false)
  })
})

describe('层序与微调', () => {
  it('置顶置底走最上层选中集', () => {
    const { editor, actions } = setup([
      node('a', { zIndex: 0 }),
      node('b', { zIndex: 1 }),
      node('c', { zIndex: 2 }),
    ])
    editor.select('a')
    actions.bringSelectedToFront()
    expect(byId(editor, 'a')?.zIndex).toBe(2)

    actions.sendSelectedToBack()
    expect(byId(editor, 'a')?.zIndex).toBe(0)
  })

  it('微调动根不动子，子树跟根走', () => {
    const { editor, actions } = setup([
      node('c', { moduleType: 'container', x: 100, y: 100 }),
      node('c1', { parentId: 'c', x: 10, y: 10 }),
    ])
    editor.setSelection(['c', 'c1'])
    actions.nudgeSelected(8, 0)

    expect(byId(editor, 'c')?.x).toBe(108)
    expect(byId(editor, 'c1')?.x).toBe(10)
  })

  it('全选只选顶层', () => {
    const { editor, actions } = setup([
      node('a', { zIndex: 0 }),
      node('c', { moduleType: 'container', zIndex: 1 }),
      node('c1', { parentId: 'c' }),
    ])
    actions.selectAllTop()
    expect([...editor.selectedIds.value].sort()).toEqual(['a', 'c'])
  })
})
