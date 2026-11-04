/**
 * @fileoverview 画布动作：对齐、等距、微调、剪贴板、断线、一键整理。
 * 右键菜单与快捷键共用这一份，所以这里钉住的就是两条路径共同的行为。
 */
import { useToast } from '@dt/ui'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import type { NodeRect } from '@/pages/Modeling/Canvas/scripts/nodeLayout'
import { useCanvasActions } from '@/pages/Modeling/Canvas/scripts/useCanvasActions'
import type { CanvasHandle } from '@/pages/Modeling/Canvas/scripts/useCanvasActions'
import { useCanvasSelection } from '@/pages/Modeling/Canvas/scripts/useCanvasSelection'
import { useModelingGraph } from '@/pages/Modeling/Canvas/scripts/useModelingGraph'

/** 卡片实测尺寸由画布量出来，用例里按图里的位置 + 固定尺寸造一份。 */
const CARD = { width: 200, height: 60 }
const wrappers: VueWrapper[] = []

function setup() {
  let graph!: ReturnType<typeof useModelingGraph>
  let selection!: ReturnType<typeof useCanvasSelection>
  let actions!: ReturnType<typeof useCanvasActions>

  const rects = (): NodeRect[] =>
    graph.graph.value.nodes.map((node) => ({
      id: node.id,
      ...node.position,
      ...CARD,
    }))

  const fit = vi.fn()
  const handle: CanvasHandle = {
    fit,
    rects,
    sizes: () => new Map(rects().map((rect) => [rect.id, CARD])),
    center: () => ({ left: 500, top: 500 }),
  }
  let currentCanvas: CanvasHandle | null = handle
  const wrapper = mount(
    defineComponent({
      setup() {
        graph = useModelingGraph()
        selection = useCanvasSelection()
        actions = useCanvasActions({
          graph,
          selection,
          canvas: () => currentCanvas,
          toast: useToast(),
        })
        return () => h('div')
      },
    }),
  )

  wrappers.push(wrapper)
  return {
    fit,
    unmount: () => {
      wrapper.unmount()
      wrappers.splice(wrappers.indexOf(wrapper), 1)
    },
    replaceCanvas: (nextFit: () => void) => {
      currentCanvas = { ...handle, fit: nextFit }
    },
    get graph() {
      return graph
    },
    get selection() {
      return selection
    },
    get actions() {
      return actions
    },
    positionOf: (id: string) =>
      graph.graph.value.nodes.find((node) => node.id === id)?.position,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
})

describe('对齐与分布', () => {
  it('对齐只动选中的那几张，没选中的原地不动', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    const b = bench.graph.addNode('src', { left: 90, top: 300 })
    const c = bench.graph.addNode('src', { left: 40, top: 500 })
    bench.selection.selectNodes([a, b])

    bench.actions.align('left')

    expect(bench.positionOf(b)?.left).toBe(0)
    expect(bench.positionOf(c)?.left).toBe(40)
  })

  it('一次对齐是一步撤销', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    const b = bench.graph.addNode('src', { left: 90, top: 300 })
    bench.selection.selectNodes([a, b])
    bench.actions.align('left')

    bench.graph.undo()

    expect(bench.positionOf(b)?.left).toBe(90)
  })

  it('选中不足两张时不入撤销栈，免得攒按不出效果的空步', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    bench.selection.selectNodes([a])
    const before = bench.graph.canUndo.value

    bench.actions.align('left')

    expect(bench.graph.canUndo.value).toBe(before)
  })

  it('方向键微调按选中集整体挪', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 10, top: 10 })
    bench.selection.selectNodes([a])

    bench.actions.nudge(8, -8)

    expect(bench.positionOf(a)).toEqual({ left: 18, top: 2 })
  })
})

describe('剪贴板', () => {
  it('复制再粘贴出来的是新节点，不是同一个 id', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    bench.selection.selectNodes([a])

    bench.actions.copy()
    bench.actions.paste()

    const ids = bench.graph.graph.value.nodes.map((node) => node.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('粘贴落在视野正中，不落在原地也不落到画布外', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: -900, top: -900 })
    bench.selection.selectNodes([a])
    bench.actions.copy()

    bench.actions.paste()

    const pasted = bench.graph.graph.value.nodes[1]
    expect(pasted?.position).toEqual({ left: 500, top: 500 })
  })

  it('粘贴之后选中的是新粘出来那一份', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    bench.selection.selectNodes([a])
    bench.actions.copy()

    bench.actions.paste()

    expect(bench.selection.selectedNodeIds.value).not.toContain(a)
    expect(bench.selection.selectedNodeIds.value).toHaveLength(1)
  })

  it('再制就地错开一点，且不动剪贴板', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 100, top: 100 })
    bench.selection.selectNodes([a])

    bench.actions.duplicate()

    expect(bench.actions.canPaste()).toBe(false)
    expect(bench.graph.graph.value.nodes[1]?.position).not.toEqual({
      left: 100,
      top: 100,
    })
  })

  it('剪贴板空着时粘贴什么都不做', () => {
    const bench = setup()

    bench.actions.paste()

    expect(bench.graph.graph.value.nodes).toHaveLength(0)
  })

  it('复制一段子图时内部的边跟着走', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    const b = bench.graph.addNode('mid', { left: 300, top: 0 })
    bench.graph.addEdge({
      id: `${a}:out->${b}:in`,
      from_node: a,
      from_port: 'out',
      to_node: b,
      to_port: 'in',
    })
    bench.selection.selectNodes([a, b])

    bench.actions.copy()
    bench.actions.paste()

    expect(bench.graph.graph.value.edges).toHaveLength(2)
  })
})

describe('断线与整理', () => {
  it('断开只拆接进来的线，接出去的留着', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 0, top: 0 })
    const b = bench.graph.addNode('mid', { left: 300, top: 0 })
    const c = bench.graph.addNode('mid', { left: 600, top: 0 })
    for (const [from, to] of [
      [a, b],
      [b, c],
    ]) {
      bench.graph.addEdge({
        id: `${from}->${to}`,
        from_node: from ?? '',
        from_port: 'out',
        to_node: to ?? '',
        to_port: 'in',
      })
    }

    bench.actions.disconnect(b)

    expect(bench.graph.graph.value.edges.map((edge) => edge.id)).toEqual([
      `${b}->${c}`,
    ])
  })

  it('一键整理把上下游排成左右', () => {
    const bench = setup()
    const a = bench.graph.addNode('src', { left: 800, top: 0 })
    const b = bench.graph.addNode('mid', { left: 0, top: 0 })
    bench.graph.addEdge({
      id: 'e',
      from_node: a,
      from_port: 'out',
      to_node: b,
      to_port: 'in',
    })

    bench.actions.autoLayout()

    expect(bench.positionOf(a)?.left).toBeLessThan(
      bench.positionOf(b)?.left ?? 0,
    )
  })

  it('全选选中所有节点', () => {
    const bench = setup()
    bench.graph.addNode('src', { left: 0, top: 0 })
    bench.graph.addNode('mid', { left: 0, top: 0 })

    bench.actions.selectAll()

    expect(bench.selection.selectedNodeIds.value).toHaveLength(2)
  })

  it('删掉一条线之后选中集跟着清空，免得删到一个已经不存在的 id', () => {
    const bench = setup()
    bench.graph.addEdge({
      id: 'e',
      from_node: 'a',
      from_port: 'out',
      to_node: 'b',
      to_port: 'in',
    })
    bench.selection.select({ kind: 'edge', id: 'e' })

    bench.actions.removeEdge('e')

    expect(bench.graph.graph.value.edges).toHaveLength(0)
    expect(bench.selection.selectedEdgeIds.value).toHaveLength(0)
  })
})

describe('自动整理的视口与撤销保护', () => {
  it('节点更新到DOM后再适应视图', async () => {
    const bench = setup()
    bench.graph.addNode('src', { left: 800, top: 900 })
    bench.actions.autoLayout()
    expect(bench.fit).not.toHaveBeenCalled()
    await nextTick()
    expect(bench.fit).toHaveBeenCalledOnce()
  })

  it('位置相同的图保持干净且不新增撤销记录，但仍适应视图', async () => {
    const bench = setup()
    bench.graph.addNode('src', { left: 80, top: 80 })
    bench.graph.reset(bench.graph.graph.value)
    const snapshot = bench.graph.graph.value
    bench.actions.autoLayout()
    expect(bench.graph.graph.value).toBe(snapshot)
    expect(bench.graph.isDirty.value).toBe(false)
    expect(bench.graph.canUndo.value).toBe(false)
    await nextTick()
    expect(bench.fit).toHaveBeenCalledOnce()
  })

  it('整理只改位置，保留配置与连线，重复整理后一次撤销仍恢复原图', async () => {
    const bench = setup()
    const a = bench.graph.addNode(
      'src',
      { left: 800, top: 10 },
      { table_code: 'energy', columns: ['temperature', 'power'] },
    )
    const b = bench.graph.addNode(
      'model',
      { left: 20, top: 700 },
      { target_column: 'power', max_depth: 4 },
    )
    bench.graph.setAlias(a, '能耗数据')
    bench.graph.addEdge({
      id: 'energy-link',
      from_node: a,
      from_port: 'frame',
      to_node: b,
      to_port: 'training',
    })
    bench.graph.reset(bench.graph.graph.value)
    const original = structuredClone(bench.graph.graph.value)
    bench.actions.autoLayout()
    expect(bench.graph.graph.value.edges).toEqual(original.edges)
    expect(
      bench.graph.graph.value.nodes.map((node) => ({
        id: node.id,
        operator: node.operator,
        alias: node.alias,
        config: node.config,
      })),
    ).toEqual(
      original.nodes.map((node) => ({
        id: node.id,
        operator: node.operator,
        alias: node.alias,
        config: node.config,
      })),
    )
    bench.graph.markSaved()
    const arranged = bench.graph.graph.value
    bench.actions.autoLayout()
    expect(bench.graph.graph.value).toBe(arranged)
    expect(bench.graph.isDirty.value).toBe(false)
    bench.graph.undo()
    expect(bench.graph.graph.value).toEqual(original)
    expect(bench.graph.canUndo.value).toBe(false)
    bench.graph.redo()
    expect(bench.graph.graph.value).toEqual(arranged)
    await nextTick()
  })

  it('空图不改变状态也不适应视图', async () => {
    const bench = setup()
    bench.actions.autoLayout()
    await nextTick()
    expect(bench.fit).not.toHaveBeenCalled()
    expect(bench.graph.canUndo.value).toBe(false)
    expect(bench.graph.isDirty.value).toBe(false)
  })

  it('整理后卸载不会在下一帧调用旧画布', async () => {
    const bench = setup()
    bench.graph.addNode('src', { left: 600, top: 0 })
    bench.actions.autoLayout()
    bench.unmount()
    await nextTick()
    expect(bench.fit).not.toHaveBeenCalled()
  })

  it('整理后画布被替换，不调用旧画布或新画布的fit', async () => {
    const bench = setup()
    const replacementFit = vi.fn()
    bench.graph.addNode('src', { left: 600, top: 0 })
    bench.actions.autoLayout()
    bench.replaceCanvas(replacementFit)
    await nextTick()
    expect(bench.fit).not.toHaveBeenCalled()
    expect(replacementFit).not.toHaveBeenCalled()
  })
})
