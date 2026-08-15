/**
 * @fileoverview 契约：编辑器文档操作全不可变、id 一经存在永不重生成、
 * 顺序钉死在 `(parentId, zIndex, id)`，整树替换的入参与这份顺序逐条对应（ADR-0012）。
 */
import { describe, expect, it } from 'vitest'
import type {
  BindingPayload,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'

import {
  boundPointKeys,
  createBinding,
  createNode,
  nextZIndex,
  removeBinding,
  removeSubtree,
  setBindings,
  setConfig,
  setConfigValue,
  setGeometry,
  setVisible,
  setZIndex,
  siblingCount,
  sortNodes,
  subtreeIds,
  toLayoutInput,
  upsertBinding,
} from '@/features/dashboard/editorDoc'

const MANIFEST: ModuleManifest = {
  type: 'demo-card',
  displayName: '演示卡片',
  category: '演示',
  defaultSize: { width: 320, height: 180 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(over: Partial<DashboardNodePayload> = {}): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo-card',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
    bindings: [],
    ...over,
  }
}

function binding(over: Partial<BindingPayload> = {}): BindingPayload {
  return {
    id: 'b1',
    nodeId: 'n1',
    fieldKey: 'value',
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
    ...over,
  }
}

describe('新建节点', () => {
  it('取清单的缺省尺寸，初始可见，没有绑定', () => {
    const created = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 0,
      zIndex: 3,
    })

    expect(created.w).toBe(320)
    expect(created.h).toBe(180)
    expect(created.zIndex).toBe(3)
    expect(created.isVisible).toBe(true)
    expect(created.bindings).toEqual([])
    expect(created.moduleType).toBe('demo-card')
  })

  it('清单的出厂配置深克隆落库，两个新节点互不共享同一只袋子', () => {
    const manifest = {
      ...MANIFEST,
      defaultConfig: { __cardStyle: { corners: false } },
    }
    const input = {
      dashboardId: 'd1',
      manifest,
      parentId: null,
      siblingCount: 0,
      zIndex: 0,
    }

    const first = createNode(input)
    const second = createNode(input)

    expect(first.configJson).toEqual({ __cardStyle: { corners: false } })
    // ⚠ 浅拷贝会让两个节点共用同一只 __cardStyle：改一个另一个跟着变，且改的还是清单本身
    expect(first.configJson.__cardStyle).not.toBe(second.configJson.__cardStyle)
    expect(first.configJson.__cardStyle).not.toBe(manifest.defaultConfig.__cardStyle)
  })

  it('清单没给出厂配置时是空袋子', () => {
    const created = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 0,
      zIndex: 0,
    })

    expect(created.configJson).toEqual({})
  })

  it('不给 client_key——id 已经唯一，再造一个本地键只是多一处会撞的东西', () => {
    const created = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 0,
      zIndex: 0,
    })

    expect(created.clientKey).toBeNull()
  })

  it('同层已有节点时错开落点，不与已有节点完全重叠', () => {
    const first = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 0,
      zIndex: 0,
    })
    const second = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 1,
      zIndex: 1,
    })

    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })

  it('两次新建给出不同的 id', () => {
    const left = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 0,
      zIndex: 0,
    })
    const right = createNode({
      dashboardId: 'd1',
      manifest: MANIFEST,
      parentId: null,
      siblingCount: 0,
      zIndex: 0,
    })

    expect(left.id).not.toBe(right.id)
  })
})

describe('同层计数', () => {
  it('nextZIndex 取同层最大 z 加一，空层给 0', () => {
    const nodes = [node({ id: 'a', zIndex: 2 }), node({ id: 'b', zIndex: 5 })]

    expect(nextZIndex(nodes, null)).toBe(6)
    expect(nextZIndex(nodes, 'a')).toBe(0)
  })

  it('siblingCount 只数同一个父下的节点', () => {
    const nodes = [
      node({ id: 'a' }),
      node({ id: 'b' }),
      node({ id: 'c', parentId: 'a' }),
    ]

    expect(siblingCount(nodes, null)).toBe(2)
    expect(siblingCount(nodes, 'a')).toBe(1)
  })
})

describe('删除子树', () => {
  it('连孙节点一起删', () => {
    const nodes = [
      node({ id: 'a' }),
      node({ id: 'b', parentId: 'a' }),
      node({ id: 'c', parentId: 'b' }),
      node({ id: 'd' }),
    ]

    expect(removeSubtree(nodes, 'a').map((item) => item.id)).toEqual(['d'])
  })

  it('subtreeIds 含自己', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b', parentId: 'a' })]

    expect([...subtreeIds(nodes, 'a')].sort()).toEqual(['a', 'b'])
  })

  it('不改原数组', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b', parentId: 'a' })]
    removeSubtree(nodes, 'a')

    expect(nodes).toHaveLength(2)
  })
})

describe('改节点', () => {
  it('几何、显隐、z 序各自只换那一个节点的引用', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' })]
    const moved = setGeometry(nodes, 'a', { x: 10, y: 20, w: 30, h: 40 })

    expect(moved[0]).not.toBe(nodes[0])
    expect(moved[1]).toBe(nodes[1])
    expect(moved[0]?.x).toBe(10)
    expect(setVisible(nodes, 'a', false)[0]?.isVisible).toBe(false)
    expect(setZIndex(nodes, 'a', 9)[0]?.zIndex).toBe(9)
  })

  it('按路径写配置，深层键逐层复制而不是就地改', () => {
    const nodes = [node({ id: 'a', configJson: { box: { pad: 4 } } })]
    const changed = setConfigValue(nodes, 'a', ['box', 'pad'], 12)

    expect(changed[0]?.configJson).toEqual({ box: { pad: 12 } })
    expect(nodes[0]?.configJson).toEqual({ box: { pad: 4 } })
  })

  it('整块替换配置', () => {
    const nodes = [node({ id: 'a', configJson: { title: '旧' } })]

    expect(setConfig(nodes, 'a', { title: '新' })[0]?.configJson).toEqual({
      title: '新',
    })
  })
})

describe('几何的取值域', () => {
  it('四项都取整——服务端是整数字段，小数会让整树替换整批被拒', () => {
    const nodes = [node({ id: 'a' })]
    const moved = setGeometry(nodes, 'a', {
      x: 10.4,
      y: 20.6,
      w: 30.5,
      h: 40.49,
    })

    expect(moved[0]?.x).toBe(10)
    expect(moved[0]?.y).toBe(21)
    expect(moved[0]?.w).toBe(31)
    expect(moved[0]?.h).toBe(40)
  })

  it('宽高夹到至少 1，不许拖成 0', () => {
    const nodes = [node({ id: 'a' })]
    const shrunk = setGeometry(nodes, 'a', { x: 0, y: 0, w: 0, h: -5 })

    expect(shrunk[0]?.w).toBe(1)
    expect(shrunk[0]?.h).toBe(1)
  })

  it('坐标夹在 ±100000 之内，与服务端同一套取值域', () => {
    const nodes = [node({ id: 'a' })]
    const far = setGeometry(nodes, 'a', {
      x: 1e9,
      y: -1e9,
      w: 1e9,
      h: 100,
    })

    expect(far[0]?.x).toBe(100000)
    expect(far[0]?.y).toBe(-100000)
    expect(far[0]?.w).toBe(100000)
  })

  it('取整之后与原值一样时原样返回那个节点，一次单击不算一次改动', () => {
    const nodes = [node({ id: 'a', x: 10, y: 20, w: 30, h: 40 })]
    const same = setGeometry(nodes, 'a', { x: 10, y: 20, w: 30, h: 40 })
    const rounded = setGeometry(nodes, 'a', {
      x: 10.2,
      y: 19.8,
      w: 30,
      h: 40,
    })

    expect(same[0]).toBe(nodes[0])
    expect(rounded[0]).toBe(nodes[0])
  })

  it('非有限数按 0 再夹，不许把 NaN 写进节点', () => {
    const nodes = [node({ id: 'a' })]
    const broken = setGeometry(nodes, 'a', {
      x: Number.NaN,
      y: 0,
      w: Number.POSITIVE_INFINITY,
      h: 40,
    })

    expect(broken[0]?.x).toBe(0)
    expect(broken[0]?.w).toBe(1)
  })

  it('整树替换的入参里几何全是整数', () => {
    const nodes = setGeometry([node({ id: 'a' })], 'a', {
      x: 1.5,
      y: 2.5,
      w: 3.5,
      h: 4.5,
    })
    const [input] = toLayoutInput(nodes)

    for (const value of [input?.x, input?.y, input?.w, input?.h]) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})

describe('绑定', () => {
  it('同一个槽再写一次沿用旧 id——重生成会让实时推送的关联键每次保存断一次', () => {
    const existing = binding({ id: 'keep-me', fieldKey: 'value' })
    const nodes = [node({ id: 'a', bindings: [existing] })]
    const replaced = upsertBinding(
      nodes,
      'a',
      binding({ id: 'brand-new', fieldKey: 'value', sourceKind: 'opcua' }),
    )

    expect(replaced[0]?.bindings[0]?.id).toBe('keep-me')
    expect(replaced[0]?.bindings[0]?.sourceKind).toBe('opcua')
  })

  it('新槽追加，并按 (fieldKey, id) 定序', () => {
    const nodes = [node({ id: 'a', bindings: [binding({ fieldKey: 'zeta' })] })]
    const added = upsertBinding(
      nodes,
      'a',
      binding({ id: 'b2', fieldKey: 'alpha' }),
    )

    expect(added[0]?.bindings.map((item) => item.fieldKey)).toEqual([
      'alpha',
      'zeta',
    ])
  })

  it('删一条只删那个槽', () => {
    const nodes = [
      node({
        id: 'a',
        bindings: [
          binding({ id: 'b1', fieldKey: 'one' }),
          binding({ id: 'b2', fieldKey: 'two' }),
        ],
      }),
    ]

    expect(
      removeBinding(nodes, 'a', 'one')[0]?.bindings.map((item) => item.id),
    ).toEqual(['b2'])
  })

  it('整批换绑定后仍按 (fieldKey, id) 定序', () => {
    const nodes = [node({ id: 'a' })]
    const replaced = setBindings(nodes, 'a', [
      binding({ id: 'b2', fieldKey: 'two' }),
      binding({ id: 'b1', fieldKey: 'one' }),
    ])

    expect(replaced[0]?.bindings.map((item) => item.fieldKey)).toEqual([
      'one',
      'two',
    ])
  })

  it('createBinding 默认是常量来源，取值还没配', () => {
    const created = createBinding('a', 'value')

    expect(created.sourceKind).toBe('static')
    expect(created.nodeKey).toBeNull()
    expect(created.staticValueJson).toBeNull()
  })
})

describe('顺序与整树替换入参', () => {
  it('节点序是 (parentId, zIndex, id)，顶层排在有父节点的前面', () => {
    const nodes = [
      node({ id: 'z', parentId: 'p', zIndex: 0 }),
      node({ id: 'b', zIndex: 5 }),
      node({ id: 'a', zIndex: 5 }),
      node({ id: 'c', zIndex: 1 }),
    ]

    expect(sortNodes(nodes).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
      'z',
    ])
  })

  it('整树替换入参逐条带上 id，且顺序与 sortNodes 一致', () => {
    const nodes = [node({ id: 'b', zIndex: 2 }), node({ id: 'a', zIndex: 1 })]

    expect(toLayoutInput(nodes).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('历史绑定的取数说明写成 snake_case，服务端才校验得到它的 node_key', () => {
    const nodes = [
      node({
        id: 'a',
        bindings: [
          binding({
            fieldKey: 'series',
            sourceKind: 'archive',
            detailJson: { nodeKey: 'src-1:temp', range: { lastWindow: '1h' } },
          }),
        ],
      }),
    ]

    expect(toLayoutInput(nodes)[0]?.bindings[0]?.detail_json).toEqual({
      node_key: 'src-1:temp',
      range: { last_window: '1h' },
    })
  })

  it('非历史来源的取数说明是 null', () => {
    const nodes = [node({ id: 'a', bindings: [binding({ fieldKey: 'v' })] })]

    expect(toLayoutInput(nodes)[0]?.bindings[0]?.detail_json).toBeNull()
  })
})

describe('本屏用到的点位', () => {
  it('只收实时绑定且已挑点的那些，去重后升序', () => {
    const nodes = [
      node({
        id: 'a',
        bindings: [
          binding({ fieldKey: 'one', sourceKind: 'opcua', nodeKey: 's:b' }),
          binding({ fieldKey: 'two', sourceKind: 'opcua', nodeKey: 's:a' }),
          binding({ fieldKey: 'three', sourceKind: 'opcua', nodeKey: null }),
          binding({ fieldKey: 'four', sourceKind: 'static' }),
        ],
      }),
      node({
        id: 'b',
        bindings: [
          binding({ fieldKey: 'one', sourceKind: 'opcua', nodeKey: 's:b' }),
        ],
      }),
    ]

    expect([...boundPointKeys(nodes)]).toEqual(['s:a', 's:b'])
  })
})
