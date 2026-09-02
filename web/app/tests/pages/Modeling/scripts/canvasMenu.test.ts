/**
 * @fileoverview 右键菜单的开合与派发：每一项都接得上一个动作。
 */
import type { ModelingGraph } from '@dt/contracts'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { MenuAction } from '@/pages/Modeling/Canvas/scripts/menuItems'
import { useCanvasSelection } from '@/pages/Modeling/Canvas/scripts/useCanvasSelection'
import {
  modLabel,
  useCanvasMenu,
} from '@/pages/Modeling/Canvas/scripts/useCanvasMenu'

const GRAPH: ModelingGraph = {
  format_version: '1',
  nodes: [
    {
      id: 'n1',
      operator: 'op',
      alias: '',
      position: { left: 0, top: 0 },
      config: {},
    },
  ],
  edges: [
    { id: 'e1', from_node: 'x', from_port: 'o', to_node: 'n1', to_port: 'i' },
  ],
}

function setup(selected: string[] = []) {
  const actions = {
    align: vi.fn(),
    spread: vi.fn(),
    autoLayout: vi.fn(),
    nudge: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    removeSelected: vi.fn(),
    removeEdge: vi.fn(),
    disconnect: vi.fn(),
    selectAll: vi.fn(),
    fit: vi.fn(),
    canPaste: vi.fn(() => true),
  }
  const onRename = vi.fn()
  const onOpenConfig = vi.fn()
  const onOpenResult = vi.fn()
  const selection = useCanvasSelection()
  selection.selectNodes(selected)
  const menu = useCanvasMenu({
    actions,
    selection,
    graph: ref(GRAPH),
    isReadonly: () => false,
    hasResult: () => true,
    onRename,
    onOpenConfig,
    onOpenResult,
  })
  return { menu, actions, onRename, onOpenConfig, onOpenResult }
}

function pick(action: MenuAction, selected: string[] = []) {
  const bench = setup(selected)
  bench.menu.open({ x: 10, y: 10 }, { nodeId: 'n1', edgeId: null })
  bench.menu.run(action)
  return bench
}

describe('开合', () => {
  it('开的时候把条目算好', () => {
    const bench = setup()

    bench.menu.open({ x: 10, y: 20 }, { nodeId: 'n1', edgeId: null })

    expect(bench.menu.menu.value?.at).toEqual({ x: 10, y: 20 })
    expect(bench.menu.menu.value?.groups.length).toBeGreaterThan(0)
  })

  it('收起之后不再渲染', () => {
    const bench = setup()
    bench.menu.open({ x: 0, y: 0 }, { nodeId: null, edgeId: null })

    bench.menu.close()

    expect(bench.menu.menu.value).toBeNull()
  })

  // ⚠ 不先收起的话，动作弹出的对话框会被菜单压着
  it('点中一项先收起再执行', () => {
    const bench = pick('config')

    expect(bench.menu.menu.value).toBeNull()
    expect(bench.onOpenConfig).toHaveBeenCalledWith('n1')
  })
})

describe('每一项都接得上一个动作', () => {
  it('对齐与分布', () => {
    expect(pick('align:left', ['n1', 'n2']).actions.align).toHaveBeenCalledWith(
      'left',
    )
    expect(pick('spread:y', ['n1', 'n2']).actions.spread).toHaveBeenCalledWith(
      'y',
    )
  })

  it('节点上的那几项', () => {
    expect(pick('result').onOpenResult).toHaveBeenCalledWith('n1')
    expect(pick('rename').onRename).toHaveBeenCalledWith('n1')
    expect(pick('disconnect').actions.disconnect).toHaveBeenCalledWith('n1')
  })

  it('剪贴板与整体那几项', () => {
    expect(pick('copy').actions.copy).toHaveBeenCalled()
    expect(pick('paste').actions.paste).toHaveBeenCalled()
    expect(pick('duplicate').actions.duplicate).toHaveBeenCalled()
    expect(pick('select-all').actions.selectAll).toHaveBeenCalled()
    expect(pick('auto-layout').actions.autoLayout).toHaveBeenCalled()
    expect(pick('fit').actions.fit).toHaveBeenCalled()
  })

  it('落在节点上时删的是整份选中', () => {
    expect(pick('remove').actions.removeSelected).toHaveBeenCalled()
  })

  it('落在线上时删的是那条线', () => {
    const bench = setup()
    bench.menu.open({ x: 0, y: 0 }, { nodeId: null, edgeId: 'e1' })

    bench.menu.run('remove')

    expect(bench.actions.removeEdge).toHaveBeenCalledWith('e1')
    expect(bench.actions.removeSelected).not.toHaveBeenCalled()
  })
})

describe('修饰键的显示名', () => {
  it('Mac 上是 ⌘，别处是 Ctrl', () => {
    expect(modLabel('MacIntel')).toBe('⌘')
    expect(modLabel('Win32')).toBe('Ctrl')
    expect(modLabel('Linux x86_64')).toBe('Ctrl')
  })
})
