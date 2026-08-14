/**
 * @fileoverview 契约：图层树的行清单与拖放落位。
 * ⚠ 落位下标按**去掉被拖节点之后**的同层序列算——与 `moveNode`「先摘再插」
 * 同一口径，差一格的话同层往前拖会稳定地落错位置，而结果看起来只是「没生效」。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import { layoutFrames } from '@/features/dashboard/editorLayout'
import {
  dropPosition,
  isOwnSubtree,
  layerRows,
  resolveDrop,
} from '@/pages/DashboardEditor/layerTree'

const BOX: ModuleManifest = {
  type: 'box',
  displayName: '容器',
  category: '布局',
  icon: 'layers',
  isContainer: true,
  defaultSize: { width: 10, height: 10 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function getManifest(moduleType: string): ModuleManifest | undefined {
  return moduleType === 'box' ? BOX : undefined
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

function rowsOf(nodes: DashboardNodePayload[], collapsed: string[] = []) {
  return layerRows(
    layoutFrames(nodes, getManifest).frames,
    nodes,
    getManifest,
    new Set(collapsed),
  )
}

describe('行清单', () => {
  it('折叠一层会连它的孙层一起收走', () => {
    const nodes = [
      node('box', { moduleType: 'box' }),
      node('kid', { parentId: 'box', moduleType: 'box' }),
      node('grand', { parentId: 'kid' }),
    ]

    expect(rowsOf(nodes).map((row) => row.id)).toEqual(['box', 'kid', 'grand'])
    expect(rowsOf(nodes, ['box']).map((row) => row.id)).toEqual(['box'])
  })

  it('祖先隐藏时后代也标成看不见', () => {
    const rows = rowsOf([
      node('box', { moduleType: 'box', isVisible: false }),
      node('kid', { parentId: 'box' }),
    ])

    expect(rows.map((row) => row.isDimmed)).toEqual([true, true])
  })

  it('容器与有无子层都照清单和节点表如实标出', () => {
    const rows = rowsOf([
      node('box', { moduleType: 'box' }),
      node('kid', { parentId: 'box' }),
    ])

    expect(rows[0]).toMatchObject({ isContainer: true, hasChildren: true })
    expect(rows[1]).toMatchObject({ isContainer: false, hasChildren: false })
  })

  it('认不出清单时显示名退回模块类型、图标退回缺省', () => {
    const rows = rowsOf([node('a', { moduleType: 'ghost' })])

    expect(rows[0]).toMatchObject({ label: 'ghost', icon: 'layout-grid' })
  })
})

describe('落点分段', () => {
  it('容器行按三等分，中段是进容器', () => {
    expect(dropPosition(2, 30, true)).toBe('before')
    expect(dropPosition(15, 30, true)).toBe('inside')
    expect(dropPosition(28, 30, true)).toBe('after')
  })

  it('非容器行只有上下两半', () => {
    expect(dropPosition(2, 30, false)).toBe('before')
    expect(dropPosition(28, 30, false)).toBe('after')
  })
})

describe('落位换算', () => {
  const SIBLINGS = [
    node('a', { zIndex: 0 }),
    node('b', { zIndex: 1 }),
    node('c', { zIndex: 2 }),
  ]

  it('拖到某行之前 = 它在去掉自己后的下标', () => {
    expect(
      resolveDrop(SIBLINGS, 'c', { id: 'b', parentId: null }, 'before'),
    ).toEqual({
      parentId: null,
      at: 1,
    })
  })

  it('同层往后拖时下标不把自己算进去', () => {
    expect(
      resolveDrop(SIBLINGS, 'a', { id: 'c', parentId: null }, 'after'),
    ).toEqual({
      parentId: null,
      at: 2,
    })
  })

  it('拖进容器不指定下标，排到该层最上面', () => {
    const nodes = [node('box', { moduleType: 'box' }), node('a', { zIndex: 1 })]

    expect(
      resolveDrop(nodes, 'a', { id: 'box', parentId: null }, 'inside'),
    ).toEqual({
      parentId: 'box',
      at: null,
    })
  })

  it('拖到自己身上什么都不做', () => {
    expect(
      resolveDrop(SIBLINGS, 'a', { id: 'a', parentId: null }, 'before'),
    ).toBeNull()
  })

  it('拖进自己的子树一律不放行', () => {
    const nodes = [
      node('box', { moduleType: 'box' }),
      node('kid', { parentId: 'box', moduleType: 'box' }),
      node('grand', { parentId: 'kid' }),
    ]

    expect(
      resolveDrop(nodes, 'box', { id: 'kid', parentId: 'box' }, 'inside'),
    ).toBeNull()
    expect(
      resolveDrop(nodes, 'box', { id: 'grand', parentId: 'kid' }, 'before'),
    ).toBeNull()
  })

  it('目标不在它自称的那一层时不猜，直接放弃', () => {
    expect(
      resolveDrop(SIBLINGS, 'a', { id: 'ghost', parentId: null }, 'before'),
    ).toBeNull()
  })
})

describe('祖先链', () => {
  it('父子链上的任一节点都算在子树里', () => {
    const nodes = [node('box'), node('kid', { parentId: 'box' })]

    expect(isOwnSubtree(nodes, 'kid', 'box')).toBe(true)
    expect(isOwnSubtree(nodes, 'box', 'kid')).toBe(false)
    expect(isOwnSubtree(nodes, null, 'box')).toBe(false)
  })

  it('父子互指成环时也会停下来', () => {
    const nodes = [node('x', { parentId: 'y' }), node('y', { parentId: 'x' })]

    expect(isOwnSubtree(nodes, 'x', 'z')).toBe(false)
  })
})
