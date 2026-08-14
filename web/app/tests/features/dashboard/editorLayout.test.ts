/**
 * @fileoverview 契约：画布排版把节点树摊成绝对矩形，容器的内缩只加一次，
 * 命中测试从上往下扫，父节点不存在的那些不画出来而是单独报出去。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { CONTAINER_CONFIG_KEY } from '@dt/modules'

import { contentSizeOf, hitTest, layoutFrames } from '@/features/dashboard/editorLayout'

const PAD = 10

const CONTAINER: ModuleManifest = {
  type: 'demo-box',
  displayName: '演示容器',
  category: '演示',
  isContainer: true,
  defaultSize: { width: 400, height: 200 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

const LEAF: ModuleManifest = { ...CONTAINER, type: 'demo-leaf', isContainer: false }

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === CONTAINER.type) return CONTAINER
  if (moduleType === LEAF.type) return LEAF
  return undefined
}

function node(over: Partial<DashboardNodePayload> = {}): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: LEAF.type,
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

describe('排版', () => {
  it('顶层节点的矩形就是它自己的坐标', () => {
    const { frames } = layoutFrames([node({ x: 30, y: 40 })], getManifest)

    expect(frames[0]).toMatchObject({
      id: 'n1',
      left: 30,
      top: 40,
      width: 100,
      height: 50,
      depth: 0,
    })
  })

  it('容器的子节点落在内容区原点上，内缩只加一次', () => {
    const nodes = [
      node({
        id: 'box',
        moduleType: CONTAINER.type,
        x: 100,
        y: 100,
        w: 400,
        h: 200,
        configJson: { [CONTAINER_CONFIG_KEY]: { pad: PAD } },
      }),
      node({ id: 'kid', parentId: 'box', x: 5, y: 6 }),
    ]

    const kid = layoutFrames(nodes, getManifest).frames.find(
      (frame) => frame.id === 'kid',
    )

    expect(kid?.left).toBe(100 + PAD + 5)
    expect(kid?.top).toBe(100 + PAD + 6)
    expect(kid?.depth).toBe(1)
  })

  it('父节点不可见时子节点也算不可见', () => {
    const nodes = [
      node({ id: 'box', moduleType: CONTAINER.type, isVisible: false }),
      node({ id: 'kid', parentId: 'box' }),
    ]

    const kid = layoutFrames(nodes, getManifest).frames.find(
      (frame) => frame.id === 'kid',
    )

    expect(kid?.isVisible).toBe(false)
  })

  it('同层按 (zIndex, id) 定序，父在子前', () => {
    const nodes = [
      node({ id: 'b', zIndex: 1 }),
      node({ id: 'a', zIndex: 1 }),
      node({ id: 'box', moduleType: CONTAINER.type, zIndex: 0 }),
      node({ id: 'kid', parentId: 'box' }),
    ]

    expect(layoutFrames(nodes, getManifest).frames.map((f) => f.id)).toEqual([
      'box',
      'kid',
      'a',
      'b',
    ])
  })

  it('父节点不存在的节点不画，单独报出 id', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'orphan', parentId: 'gone' })]
    const layout = layoutFrames(nodes, getManifest)

    expect(layout.frames.map((frame) => frame.id)).toEqual(['a'])
    expect([...layout.detachedIds]).toEqual(['orphan'])
  })

  it('不传清单解析器时一个容器都认不出来，子节点不再内缩', () => {
    const nodes = [
      node({
        id: 'box',
        moduleType: CONTAINER.type,
        configJson: { [CONTAINER_CONFIG_KEY]: { pad: PAD } },
      }),
      node({ id: 'kid', parentId: 'box', x: 5, y: 5 }),
    ]

    const kid = layoutFrames(nodes).frames.find((frame) => frame.id === 'kid')

    expect(kid?.left).toBe(5)
  })
})

describe('命中测试', () => {
  const frames = layoutFrames(
    [
      node({ id: 'under', x: 0, y: 0, w: 200, h: 200, zIndex: 0 }),
      node({ id: 'over', x: 50, y: 50, w: 50, h: 50, zIndex: 1 }),
      node({ id: 'gone', x: 0, y: 0, w: 200, h: 200, zIndex: 2, isVisible: false }),
    ],
    getManifest,
  ).frames

  it('取最上面那个', () => {
    expect(hitTest(frames, { x: 60, y: 60 })).toBe('over')
  })

  it('不可见的节点不参与命中', () => {
    expect(hitTest(frames, { x: 10, y: 10 })).toBe('under')
  })

  it('点在所有矩形之外时给 null', () => {
    expect(hitTest(frames, { x: 900, y: 900 })).toBeNull()
  })
})

describe('容器内容区尺寸', () => {
  it('容器扣掉四边内缩', () => {
    const box = node({
      moduleType: CONTAINER.type,
      w: 400,
      h: 200,
      configJson: { [CONTAINER_CONFIG_KEY]: { pad: PAD } },
    })

    expect(contentSizeOf(box, CONTAINER)).toEqual({
      width: 400 - PAD * 2,
      height: 200 - PAD * 2,
    })
  })

  it('非容器不扣', () => {
    expect(contentSizeOf(node({ w: 120, h: 60 }), LEAF)).toEqual({
      width: 120,
      height: 60,
    })
  })
})
