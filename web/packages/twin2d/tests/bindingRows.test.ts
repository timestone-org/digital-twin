/**
 * @fileoverview 绑定行 ⇄ 2D 孪生实体的对应，以及一个节点的「有效槽位」怎么筛。
 *
 * ⚠ 这一层守的是整套绑定里最安静的那个错：行号是文档序、实体本身不在 fieldKey 里
 * 露面——少扫一处引用位置、或让运行期状态参与筛选，每一行照样有值、读数照常刷新，
 * 只是全都接错了对象，界面上一点异常都看不出来。
 */
import { describe, expect, it } from 'vitest'

import {
  effectiveSlotsOf,
  twin2dBindingRows,
  twin2dRowCounts,
  twin2dRowLabels,
  twin2dRowsOfEntity,
} from '../src/bindingRows'
import { normalizeTwin2dConfig } from '../src/normalize'
import { TWIN_2D_BUILTIN_NODE_STYLE_MAP } from '../src/presets/nodes'
import type { Twin2dConfig } from '../src/types'

/** 两个 live 槽：每条用例只在一处引用 `b`，于是有效槽位该只剩 `b`。 */
const TWO_SLOTS = [
  { key: 'a', label: '甲' },
  { key: 'b', label: '乙' },
]

/** 一份文档：一个样式加一个用它的节点，其余键由归一化铺缺省。 */
function docOf(
  style: Record<string, unknown>,
  node: Record<string, unknown> = {},
): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [{ id: 'st', slots: TWO_SLOTS, ...style }],
    nodes: [{ id: 'n1', styleId: 'st', label: '锅炉房', ...node }],
  })
}

/** 一个节点的有效槽位键。 */
function slotKeys(config: Twin2dConfig, nodeId = 'n1'): string[] {
  return effectiveSlotsOf(config, nodeId).map((slot) => slot.key)
}

/** 一个槽的全部行 fieldKey。 */
function fieldKeysOf(config: Twin2dConfig, slotKey: string): string[] {
  return twin2dBindingRows(config)
    .filter((row) => row.slotKey === slotKey)
    .map((row) => row.fieldKey)
}

/** 一个槽的全部行喂的实体 id。 */
function entityIdsOf(config: Twin2dConfig, slotKey: string): string[] {
  return twin2dBindingRows(config)
    .filter((row) => row.slotKey === slotKey)
    .map((row) => row.entityId)
}

/** 两个节点一条连线：n1 有两个有效槽位、n2 有一个。 */
const TWO_NODE_DOC = normalizeTwin2dConfig({
  styles: [
    {
      id: 'boiler',
      slots: [
        { key: 'out_c', label: '出水温度' },
        { key: 'in_c', label: '回水温度' },
      ],
      prims: [
        { id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'out_c' } },
        { id: 't2', kind: 'txt', src: { kind: 'slot', slot: 'in_c' } },
      ],
    },
    {
      id: 'station',
      slots: [{ key: 'kpa', label: '压力' }],
      prims: [{ id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'kpa' } }],
    },
  ],
  nodes: [
    { id: 'n1', styleId: 'boiler', label: '锅炉房' },
    { id: 'n2', styleId: 'station', label: '换热站' },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } }],
})

// 少扫一处，那个槽就永远绑不上，且零报错
describe('有效槽位：静态可达的七处引用', () => {
  it('`txt` 图元的槽来源算一处，藏在 box 子树里也算', () => {
    const config = docOf({
      prims: [
        {
          id: 'root',
          kind: 'box',
          children: [
            { id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'b' } },
          ],
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('图元 `when` 条件里的槽算一处', () => {
    const config = docOf({
      prims: [
        {
          id: 'v1',
          kind: 'vec',
          when: { kind: 'slot', slot: 'b', op: 'gt', value: 40 },
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('变体条件里的槽算一处，裹在 `not` 里的 `has` 也要扫进去', () => {
    const config = docOf({
      prims: [{ id: 'v1', kind: 'vec' }],
      variants: [
        {
          id: 'lonely',
          when: {
            kind: 'not',
            of: { kind: 'has', slots: ['b'], mode: 'all' },
          },
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('变体补丁把文本换成槽来源，那个槽算一处', () => {
    const config = docOf({
      prims: [{ id: 't1', kind: 'txt', src: { kind: 'lit', text: '—' } }],
      variants: [
        {
          id: 'alarm',
          when: { kind: 'status', in: ['alarm'] },
          patch: { t1: { src: { kind: 'slot', slot: 'b' } } },
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('派生槽算式里引到的槽算一处', () => {
    const config = docOf({
      slots: [
        ...TWO_SLOTS,
        {
          key: 'r',
          label: '读数行',
          kind: 'derived',
          expr: { kind: 'slot', slot: 'b' },
        },
      ],
      prims: [],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('节点级 `layers` 追加图元里的引用算一处', () => {
    const config = docOf(
      { prims: [] },
      { layers: [{ id: 'l1', kind: 'txt', src: { kind: 'slot', slot: 'b' } }] },
    )

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('节点级 `patch` 补出来的显示条件里的槽算一处', () => {
    const config = docOf(
      { prims: [{ id: 't1', kind: 'txt', src: { kind: 'lit', text: '—' } }] },
      { patch: { t1: { when: { kind: 'has', slots: ['b'], mode: 'any' } } } },
    )

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('补丁把来源换成字面量的那一条不引槽，原图元引的照旧算数', () => {
    const config = docOf({
      prims: [{ id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'b' } }],
      variants: [
        {
          id: 'quiet',
          when: { kind: 'state', state: 'hover' },
          patch: { t1: { src: { kind: 'lit', text: '—' } } },
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })
})

// 行号是与服务端的静态契约：让运行期状态影响行数，等于「墙上的值一变，绑定就全体错位」
describe('有效槽位：运行期状态一律不参与筛选', () => {
  it('`hidden` 的图元引到的槽照样成行', () => {
    const config = docOf({
      prims: [
        {
          id: 't1',
          kind: 'txt',
          hidden: true,
          src: { kind: 'slot', slot: 'b' },
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('`when` 当前不满足的图元引到的槽照样成行', () => {
    const config = docOf({
      prims: [
        {
          id: 't1',
          kind: 'txt',
          when: { kind: 'state', state: 'hover' },
          src: { kind: 'slot', slot: 'b' },
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })

  it('当前没命中的变体里引到的槽照样成行', () => {
    const config = docOf({
      prims: [{ id: 't1', kind: 'txt', src: { kind: 'lit', text: '—' } }],
      variants: [
        {
          id: 'never',
          when: { kind: 'slot', slot: 'b', op: 'gt', value: 999 },
          patch: {},
        },
      ],
    })

    expect(slotKeys(config)).toEqual(['b'])
  })
})

describe('有效槽位的取舍与顺序', () => {
  // 派生槽没有数据来源，给它一行是让用户绑一个永远喂不进去的点位
  it('派生槽自己不成行，它算式里引到的槽成行', () => {
    const config = docOf({
      slots: [
        { key: 'a', label: '甲' },
        {
          key: 'r',
          label: '读数行',
          kind: 'derived',
          expr: {
            kind: 'join',
            of: [
              { kind: 'slot', slot: 'a' },
              { kind: 'lit', value: '℃' },
            ],
            sep: ' ',
          },
        },
      ],
      prims: [{ id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'r' } }],
    })

    expect(slotKeys(config)).toEqual(['a'])
  })

  it('样式槽在前、节点追加槽在后，同键只留最先一条', () => {
    const config = docOf(
      {
        slots: [{ key: 'a', label: '甲' }],
        prims: [{ id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'a' } }],
      },
      {
        slots: [
          { key: 'z', label: '追加' },
          { key: 'a', label: '同键的后来者' },
        ],
        layers: [{ id: 'l1', kind: 'txt', src: { kind: 'slot', slot: 'z' } }],
      },
    )

    expect(
      effectiveSlotsOf(config, 'n1').map((slot) => [slot.key, slot.label]),
    ).toEqual([
      ['a', '甲'],
      ['z', '追加'],
    ])
  })

  it('一处引用都没有的槽位不成行', () => {
    expect(slotKeys(docOf({ prims: [] }))).toEqual([])
  })

  it('取不到这个节点时给空表', () => {
    expect(effectiveSlotsOf(TWO_NODE_DOC, 'no-such-node')).toEqual([])
  })
})

describe('三个槽的行', () => {
  it('三个槽各按自己的文档序摊开', () => {
    expect(twin2dBindingRows(TWO_NODE_DOC).map((row) => row.fieldKey)).toEqual([
      'nodeValues[0].value',
      'nodeValues[1].value',
      'nodeValues[2].value',
      'nodeStatus[0].status',
      'nodeStatus[1].status',
      'edgeValues[0].active',
    ])
  })

  it('节点读数是「节点 × 有效槽位」扁平，每一行都带着它喂的那个槽位键', () => {
    const rows = twin2dBindingRows(TWO_NODE_DOC).filter(
      (row) => row.slotKey === 'nodeValues',
    )

    expect(rows.map((row) => [row.entityId, row.entitySlot])).toEqual([
      ['n1', 'out_c'],
      ['n1', 'in_c'],
      ['n2', 'kpa'],
    ])
  })

  it('行的槽位序列与 effectiveSlotsOf 逐个相同', () => {
    const rows = twin2dBindingRows(TWO_NODE_DOC).filter(
      (row) => row.slotKey === 'nodeValues' && row.entityId === 'n1',
    )

    expect(rows.map((row) => row.entitySlot)).toEqual(
      effectiveSlotsOf(TWO_NODE_DOC, 'n1').map((slot) => slot.key),
    )
  })

  it('状态一个节点一行，连线一条一行', () => {
    expect(entityIdsOf(TWO_NODE_DOC, 'nodeStatus')).toEqual(['n1', 'n2'])
    expect(entityIdsOf(TWO_NODE_DOC, 'edgeValues')).toEqual(['e1'])
  })

  // ⚠ 组的键是这一组第一个子槽的 fieldKey（`BindingPanel` 的 labelOf）：挂到 value
  //   上的话三个子槽都摆在那儿、组标题却退回「第 N 行」
  it('连线的行挂在第一个子槽 active 上，不按三个子槽翻成三行', () => {
    expect(fieldKeysOf(TWO_NODE_DOC, 'edgeValues')).toEqual([
      'edgeValues[0].active',
    ])
  })

  it('只有节点读数行带槽位键，状态行与连线行给空串', () => {
    const rows = twin2dBindingRows(TWO_NODE_DOC).filter(
      (row) => row.slotKey !== 'nodeValues',
    )

    expect(rows.map((row) => row.entitySlot)).toEqual(['', '', ''])
  })
})

describe('行标签', () => {
  it('节点读数的行名是「节点名 · 槽位名」，状态行只有节点名', () => {
    const labels = twin2dRowLabels(TWO_NODE_DOC)

    expect(labels['nodeValues[0].value']).toEqual({
      title: '锅炉房 · 出水温度',
      id: 'n1',
    })
    expect(labels['nodeStatus[0].status']).toEqual({
      title: '锅炉房',
      id: 'n1',
    })
  })

  it('连线的行名是两端的节点名', () => {
    expect(twin2dRowLabels(TWO_NODE_DOC)['edgeValues[0].active']).toEqual({
      title: '锅炉房 → 换热站',
      id: 'e1',
    })
  })

  // ⚠ 一行没有任何标识时用户只能数第几行，而数错了不会有任何提示
  it('没起名的节点与没起名的槽位各自退回它的 id 与键', () => {
    const config = docOf(
      {
        slots: [{ key: 'b' }],
        prims: [{ id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'b' } }],
      },
      { label: '' },
    )

    expect(twin2dRowLabels(config)['nodeValues[0].value']).toEqual({
      title: 'n1 · b',
      id: 'n1',
    })
  })

  // 编辑器内存里的草稿：节点刚删掉、还没重派绑定，这一刻两端未必都在册
  it('一端的节点已经不在册时退回它的 id，不留半段空名字', () => {
    const draft: Twin2dConfig = {
      ...TWO_NODE_DOC,
      nodes: TWO_NODE_DOC.nodes.filter((node) => node.id !== 'n2'),
    }

    expect(twin2dRowLabels(draft)['edgeValues[0].active']).toEqual({
      title: '锅炉房 → n2',
      id: 'e1',
    })
  })
})

describe('每个槽应有几行', () => {
  const EMPTY = normalizeTwin2dConfig({})

  // ⚠ 下面三条断的都是「键在表里且为 0」：漏掉的键会被绑点面板当成「行数由用户手工
  //   增删」，于是摆出一个加了也喂不到任何东西的「新增一行」
  it('一个节点都没有时 nodeValues 是 0 而不是缺席', () => {
    expect(twin2dRowCounts(EMPTY).nodeValues).toBe(0)
  })

  it('一个节点都没有时 nodeStatus 是 0 而不是缺席', () => {
    expect(twin2dRowCounts(EMPTY).nodeStatus).toBe(0)
  })

  it('一条连线都没有时 edgeValues 是 0 而不是缺席', () => {
    expect(twin2dRowCounts(EMPTY).edgeValues).toBe(0)
  })

  it('按实体数给：节点读数按有效槽位总数，其余两个槽按实体数', () => {
    expect(twin2dRowCounts(TWO_NODE_DOC)).toEqual({
      nodeValues: 3,
      nodeStatus: 2,
      edgeValues: 1,
    })
  })
})

describe('实体增删之后的行号', () => {
  /** 每个节点一个有效槽位，于是行号与节点序一一对应。 */
  function docOfNodes(ids: readonly string[]): Twin2dConfig {
    return normalizeTwin2dConfig({
      styles: [
        {
          id: 'st',
          slots: [{ key: 'kpa', label: '压力' }],
          prims: [
            { id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'kpa' } },
          ],
        },
      ],
      nodes: ids.map((id) => ({ id, styleId: 'st', label: id })),
    })
  }

  it('删掉中间一个节点，它之后的行号整体前移', () => {
    const before = docOfNodes(['n1', 'n2', 'n3'])
    const after = docOfNodes(['n1', 'n3'])

    expect(entityIdsOf(before, 'nodeValues')).toEqual(['n1', 'n2', 'n3'])
    expect(entityIdsOf(after, 'nodeValues')).toEqual(['n1', 'n3'])
    expect(entityIdsOf(after, 'nodeStatus')).toEqual(['n1', 'n3'])
    // 原来第 2 行喂 n3，删掉中间那个之后 n3 成了第 1 行
    expect(twin2dRowLabels(after)['nodeValues[1].value']).toEqual({
      title: 'n3 · 压力',
      id: 'n3',
    })
  })

  it('一个有效槽位都没有的节点不产读数行，也不产一行空的', () => {
    const config = normalizeTwin2dConfig({
      styles: [
        { id: 'blank', slots: [{ key: 'a', label: '甲' }] },
        {
          id: 'st',
          slots: [{ key: 'kpa', label: '压力' }],
          prims: [
            { id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'kpa' } },
          ],
        },
      ],
      nodes: [
        { id: 'n1', styleId: 'blank', label: '装饰' },
        { id: 'n2', styleId: 'st', label: '锅炉房' },
      ],
    })

    expect(entityIdsOf(config, 'nodeValues')).toEqual(['n2'])
    expect(fieldKeysOf(config, 'nodeValues')).toEqual(['nodeValues[0].value'])
    // 状态是一条独立的数据线，读数一行都没有的节点照样占一条状态行
    expect(entityIdsOf(config, 'nodeStatus')).toEqual(['n1', 'n2'])
  })

  it('指向已删节点的连线归一化时就丢了，行里不占位', () => {
    const config = normalizeTwin2dConfig({
      nodes: [{ id: 'n1' }, { id: 'n2' }],
      edges: [
        { id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } },
        { id: 'e2', from: { nodeId: 'n1' }, to: { nodeId: 'gone' } },
      ],
    })

    expect(entityIdsOf(config, 'edgeValues')).toEqual(['e1'])
    expect(twin2dRowCounts(config).edgeValues).toBe(1)
  })
})

describe('某个实体占了哪几行', () => {
  // ⚠ 给的是全局行号，过滤之后不许重编：fieldKey 是「槽[行号].子键」
  it('一个节点给它的读数行加那一条状态行，行号照旧', () => {
    expect(
      twin2dRowsOfEntity(TWO_NODE_DOC, 'n2').map((row) => row.fieldKey),
    ).toEqual(['nodeValues[2].value', 'nodeStatus[1].status'])
  })

  it('一条连线只给它自己那一行', () => {
    expect(
      twin2dRowsOfEntity(TWO_NODE_DOC, 'e1').map((row) => row.fieldKey),
    ).toEqual(['edgeValues[0].active'])
  })

  it('认不出的 id 给空表', () => {
    expect(twin2dRowsOfEntity(TWO_NODE_DOC, 'no-such-id')).toEqual([])
  })
})

describe('样式落回预置库', () => {
  it('节点引的是预置样式时照样产行，且派生槽一个都不占行', () => {
    const config = normalizeTwin2dConfig({
      nodes: [{ id: 'n1', styleId: 'water-tank', label: '蓄热水箱' }],
    })
    const preset = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get('water-tank')
    const declared = preset?.slots ?? []
    const keys = slotKeys(config)

    expect(keys.length).toBeGreaterThan(0)
    expect(declared.map((slot) => slot.key)).toEqual(
      expect.arrayContaining(keys),
    )
    expect(
      keys.filter((key) =>
        declared.some((slot) => slot.key === key && slot.kind === 'derived'),
      ),
    ).toEqual([])
  })

  it('文档里的同 id 样式盖过预置库', () => {
    const config = normalizeTwin2dConfig({
      styles: [
        {
          id: 'water-tank',
          slots: [{ key: 'only', label: '自定义' }],
          prims: [
            { id: 't1', kind: 'txt', src: { kind: 'slot', slot: 'only' } },
          ],
        },
      ],
      nodes: [{ id: 'n1', styleId: 'water-tank' }],
    })

    expect(slotKeys(config)).toEqual(['only'])
  })

  it('样式既不在文档里也不在预置库里的节点不产读数行，状态行还在', () => {
    const config = normalizeTwin2dConfig({
      nodes: [{ id: 'n1', styleId: 'no-such-style', label: '孤儿' }],
    })

    expect(slotKeys(config)).toEqual([])
    expect(twin2dRowCounts(config).nodeValues).toBe(0)
    expect(twin2dRowCounts(config).nodeStatus).toBe(1)
  })
})
