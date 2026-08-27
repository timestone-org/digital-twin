/**
 * @fileoverview 契约：节点的增删改、复制、层序与对齐分布全是纯函数，改完再归一化不变形；
 * 删节点必须把挂在它上头的连线一起报出来。
 *
 * ⚠ 什么都没改时必须原样返回入参那个引用——文档态按引用判要不要压一帧撤销，
 * 换了新引用却什么都没改，撤销键上就多出一格按了没反应的空步。
 * ⚠ 改值那一支不过归一化：过了的话文本框逐键写回时会把用户刚敲下的空格 trim 掉。
 */
import { normalizeNodeStyles, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  addNode,
  alignDeltas,
  alignNodes,
  distributeDeltas,
  distributeNodes,
  duplicateNodes,
  freshTwin2dId,
  newTwin2dId,
  orderList,
  orderNodes,
  removeNodes,
  updateNode,
} from '@/pages/Twin2dEditor/scripts/nodeOps'

/** 一只 40×20 的样式盒，算对齐时的宽高就取它。 */
const STYLES: ReadonlyMap<string, Twin2dNodeStyle> = new Map(
  normalizeNodeStyles([{ id: 'sty', size: { w: 40, h: 20 } }]).map((style) => [
    style.id,
    style,
  ]),
)

/** 造 id 的桩：按调用次序发号，用例才断言得出具体的 id。 */
function idSeries(prefix: string): () => string {
  let seq = 0
  return () => {
    seq += 1
    return `${prefix}${seq}`
  }
}

function configOf(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [{ id: 'sty', size: { w: 40, h: 20 } }],
    nodes: [
      { id: 'a', styleId: 'sty', x: 0, y: 0 },
      { id: 'b', styleId: 'sty', x: 100, y: 50 },
      { id: 'c', styleId: 'sty', x: 300, y: 200 },
    ],
    edges: [
      {
        id: 'e1',
        styleId: 'wire',
        from: { nodeId: 'a' },
        to: { nodeId: 'b' },
      },
      {
        id: 'e2',
        styleId: 'wire',
        from: { nodeId: 'b' },
        to: { nodeId: 'c' },
      },
    ],
  })
}

function idsOf(config: Twin2dConfig): string[] {
  return config.nodes.map((node) => node.id)
}

describe('id 工厂', () => {
  it('随机 id 带前缀且长度稳定', () => {
    const id = newTwin2dId('node')

    expect(id.startsWith('node-')).toBe(true)
    expect(id).toHaveLength('node-'.length + 6)
  })

  it('避开已占用的 id', () => {
    const taken = new Set(['x-1', 'x-2'])

    expect(freshTwin2dId('x', taken, idSeries('x-'))).toBe('x-3')
  })

  // ⚠ 注入的工厂只发一个固定值时不许死循环，也不许交出重名的 id
  it('工厂只会给重名时改走序号', () => {
    const taken = new Set(['x-0', 'x-1'])

    expect(freshTwin2dId('x', taken, () => 'x-0')).toBe('x-2')
  })
})

describe('新增', () => {
  it('追加在末尾并交出新 id', () => {
    const next = addNode(configOf(), { styleId: 'sty', x: 8, y: 9 }, () => 'n9')

    expect(next.id).toBe('n9')
    expect(idsOf(next.config)).toEqual(['a', 'b', 'c', 'n9'])
    expect(next.config.nodes.at(-1)?.x).toBe(8)
  })

  it('缺省交给归一化补，不在这里抄一份', () => {
    const next = addNode(configOf(), { styleId: 'sty' }, () => 'n9')

    expect(next.config.nodes.at(-1)?.labelPos).toBe('bottom')
    expect(next.config.nodes.at(-1)?.rotate).toBe(0)
  })

  it('改完再归一化不变形', () => {
    const next = addNode(configOf(), { styleId: 'sty' }, () => 'n9').config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('改值', () => {
  it('只换被点名的那一个，没动的那些连引用都不换', () => {
    const config = configOf()

    const next = updateNode(config, 'b', { label: '泵房', x: 120 })

    expect(next.nodes[1]?.label).toBe('泵房')
    expect(next.nodes[1]?.x).toBe(120)
    expect(next.nodes[0]).toBe(config.nodes[0])
  })

  it('节点不在就原样返回入参那个引用', () => {
    const config = configOf()

    expect(updateNode(config, 'nope', { label: 'x' })).toBe(config)
  })

  // ⚠ 逐键写回时归一化会把刚敲下的空格 trim 掉，那个空格就永远打不出来
  it('改值不过归一化，用户敲的空格留得住', () => {
    const next = updateNode(configOf(), 'a', { label: '一号 ' })

    expect(next.nodes[0]?.label).toBe('一号 ')
  })

  it('取值干净时改完再归一化不变形', () => {
    const next = updateNode(configOf(), 'a', { label: '一号' })

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('复制', () => {
  it('每份副本插在原件后面并带上位移', () => {
    const next = duplicateNodes(
      configOf(),
      ['a', 'c'],
      { x: 10, y: 20 },
      idSeries('copy'),
    )

    expect(next.ids).toEqual(['copy1', 'copy2'])
    expect(idsOf(next.config)).toEqual(['a', 'copy1', 'b', 'c', 'copy2'])
    expect(next.config.nodes[1]?.x).toBe(10)
    expect(next.config.nodes[1]?.y).toBe(20)
  })

  // ⚠ 跟着复制就得替用户决定副本连谁，而那不是按下这个键时想的事
  it('挂在原节点上的连线不跟着复制', () => {
    const next = duplicateNodes(configOf(), ['a'], { x: 0, y: 0 })

    expect(next.config.edges).toHaveLength(2)
  })

  it('一个都没点中时原样返回入参那个引用', () => {
    const config = configOf()

    expect(duplicateNodes(config, ['nope'], { x: 1, y: 1 }).config).toBe(config)
  })

  it('改完再归一化不变形', () => {
    const next = duplicateNodes(configOf(), ['b'], { x: 4, y: 4 }).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('删除', () => {
  // ⚠ 只报被点名的那几个，选中态就会停在一条已经不存在的连线上
  it('删节点把跟着没的连线一起报出来', () => {
    const next = removeNodes(configOf(), ['b'])

    expect(idsOf(next.config)).toEqual(['a', 'c'])
    expect(next.removed.nodes).toEqual(['b'])
    expect(next.removed.edges).toEqual(['e1', 'e2'])
    expect(next.removed.marks).toEqual([])
  })

  it('一个都没点中时原样返回入参那个引用', () => {
    const config = configOf()
    const next = removeNodes(config, ['nope'])

    expect(next.config).toBe(config)
    expect(next.removed.nodes).toEqual([])
  })

  it('改完再归一化不变形', () => {
    const next = removeNodes(configOf(), ['c']).config

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('层序', () => {
  it('置顶把一批挪到末尾并保持批内次序', () => {
    expect(idsOf(orderNodes(configOf(), ['a', 'b'], 'front'))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('置底把一批挪到表头', () => {
    expect(idsOf(orderNodes(configOf(), ['c'], 'back'))).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('上移一层只与相邻的那个对调', () => {
    expect(idsOf(orderNodes(configOf(), ['a'], 'forward'))).toEqual([
      'b',
      'a',
      'c',
    ])
  })

  it('下移一层只与相邻的那个对调', () => {
    expect(idsOf(orderNodes(configOf(), ['c'], 'backward'))).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  it('已经到顶再上移就原样返回入参那个引用', () => {
    const config = configOf()

    expect(orderNodes(config, ['c'], 'forward')).toBe(config)
    expect(orderNodes(config, ['a'], 'backward')).toBe(config)
  })

  // ⚠ 一批一起动时批内相对次序不许乱：乱了等于把绑定行也对调了
  it('整批上移时批内次序不变', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(orderList(list, ['a', 'b'], 'forward').map((it) => it.id)).toEqual([
      'c',
      'a',
      'b',
    ])
  })
})

describe('对齐', () => {
  it('六档各自对到这一批自己的外接盒上', () => {
    const boxes = [
      { x: 0, y: 0, w: 40, h: 20 },
      { x: 100, y: 60, w: 20, h: 40 },
    ]

    expect(alignDeltas(boxes, 'left')).toEqual([
      { x: 0, y: 0 },
      { x: -100, y: 0 },
    ])
    expect(alignDeltas(boxes, 'right')).toEqual([
      { x: 80, y: 0 },
      { x: 0, y: 0 },
    ])
    expect(alignDeltas(boxes, 'hcenter')).toEqual([
      { x: 40, y: 0 },
      { x: -50, y: 0 },
    ])
    expect(alignDeltas(boxes, 'top')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: -60 },
    ])
    expect(alignDeltas(boxes, 'bottom')).toEqual([
      { x: 0, y: 80 },
      { x: 0, y: 0 },
    ])
    expect(alignDeltas(boxes, 'vcenter')).toEqual([
      { x: 0, y: 40 },
      { x: 0, y: -30 },
    ])
  })

  it('一个盒都没有时一条位移都不出', () => {
    expect(alignDeltas([], 'left')).toEqual([])
  })

  it('节点按左边对齐，没点中的不动', () => {
    const next = alignNodes(configOf(), ['a', 'b'], STYLES, 'left')

    expect(next.nodes.map((node) => node.x)).toEqual([0, 0, 300])
  })

  // ⚠ 样式悬空的节点在画面上没有盒，算进外接范围会把整批对到看不见的边上
  it('样式寻不到的节点不参与对齐', () => {
    const config = updateNode(configOf(), 'b', { styleId: 'gone' })
    const next = alignNodes(config, ['a', 'b'], STYLES, 'left')

    expect(next).toBe(config)
  })

  it('一步都不用挪时原样返回入参那个引用', () => {
    const config = configOf()

    expect(alignNodes(config, ['a'], STYLES, 'left')).toBe(config)
  })
})

describe('分布', () => {
  it('两端不动，中间的按缝一样宽摆', () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
      { x: 100, y: 0, w: 10, h: 10 },
    ]

    expect(distributeDeltas(boxes, 'x')).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 0 },
    ])
  })

  it('按位置排序后再分，输入序不影响结果', () => {
    const boxes = [
      { x: 100, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
    ]

    expect(distributeDeltas(boxes, 'x')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ])
  })

  // ⚠ 两只之间没有「中间」可分
  it('少于三只时一步都不挪', () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 10, h: 10 },
    ]

    expect(distributeDeltas(boxes, 'x')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ])
    expect(distributeDeltas([], 'y')).toEqual([])
  })

  it('节点沿纵轴分布', () => {
    const config = normalizeTwin2dConfig({
      styles: [{ id: 'sty', size: { w: 40, h: 20 } }],
      nodes: [
        { id: 'a', styleId: 'sty', x: 0, y: 0 },
        { id: 'b', styleId: 'sty', x: 0, y: 10 },
        { id: 'c', styleId: 'sty', x: 0, y: 100 },
      ],
    })

    const next = distributeNodes(config, ['a', 'b', 'c'], STYLES, 'y')

    expect(next.nodes.map((node) => node.y)).toEqual([0, 50, 100])
  })
})
