/**
 * @fileoverview 绑定行 ⇄ 实体的对应，以及实体增删之后的重映射。
 *
 * ⚠ 这一层守的是全套孪生绑定里最安静的那个错：数组绑定的行号是文档序，实体
 * 本身不在 fieldKey 里露面——删掉一个实体之后，它后面每一行都改喂前一个实体。
 * 绑定还在、读数照常刷新，只是全接错了对象，界面上一点异常都看不出来。
 */
import { describe, expect, it } from 'vitest'

import {
  remapBindingRows,
  remapTwinBindings,
  twinBindingRows,
  twinRowCounts,
  twinRowLabels,
  twinRowsOfEntity,
} from '../src/bindingRows'
import { normalizeTwinConfig } from '../src/normalize'
import { flattenPanelFields } from '../src/normalizeElements'
import {
  stitchAnchorValues,
  stitchPanelValues,
  stitchPartValues,
} from '../src/twinMath'

const CONFIG = normalizeTwinConfig({
  anchors: [
    { id: 'a1', name: '进口' },
    { id: 'a2', name: '出口' },
  ],
  panels: [
    { id: 'p1', name: '泵组', fields: [{ key: 'temp', label: '温度' }] },
  ],
  arrows: [{ id: 'ar1', name: '进气' }],
  flows: [{ id: 'f1', name: '冷却水' }],
})

function binding(fieldKey: string) {
  return {
    id: fieldKey,
    fieldKey,
    sourceKind: 'opcua' as const,
    nodeKey: fieldKey,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
  }
}

describe('绑定行的推导', () => {
  it('四个槽各按自己的文档序摊开', () => {
    expect(twinBindingRows(CONFIG).map((row) => row.fieldKey)).toEqual([
      'anchorValues[0].value',
      'anchorValues[1].value',
      'panelValues[0].value',
      'arrowValues[0].value',
      'flowValues[0].intensity',
    ])
  })

  it('每一行都带着它喂的实体 id', () => {
    const rows = twinBindingRows(CONFIG)
    expect(rows.map((row) => row.entityId)).toEqual([
      'a1',
      'a2',
      'p1::temp',
      'ar1',
      'f1',
    ])
  })

  it('信息牌的行名带上牌名与字段名', () => {
    const labels = twinRowLabels(CONFIG)
    expect(labels['panelValues[0].value']).toEqual({
      title: '泵组 · 温度',
      // ⚠ 与信息牌字段列表上显示的那一份逐字相同：绑的时候靠它核对
      id: 'p1::temp',
    })
  })

  // ⚠ 一行没有任何标识时用户只能数第几行，而数错了不会有任何提示
  it('没起名的实体退回它的 id，不留一行空标题', () => {
    const config = normalizeTwinConfig({ anchors: [{ id: 'a9' }] })
    expect(twinRowLabels(config)['anchorValues[0].value']).toEqual({
      title: 'a9',
      id: 'a9',
    })
  })

  it('箭头没起名时退回标签文案', () => {
    const config = normalizeTwinConfig({
      arrows: [{ id: 'ar9', labelText: '回风' }],
    })
    expect(twinRowLabels(config)['arrowValues[0].value']).toEqual({
      title: '回风',
      id: 'ar9',
    })
  })

  it('一个实体都没有时一行都不出', () => {
    expect(twinBindingRows(normalizeTwinConfig({}))).toEqual([])
  })
})

describe('每个槽应有几行', () => {
  it('按实体数给，信息牌与部件详情按扁平化后的字段数', () => {
    const counts = twinRowCounts(
      normalizeTwinConfig({
        anchors: [{ id: 'a1' }, { id: 'a2' }],
        panels: [
          { id: 'p1', fields: [{ key: 'a' }, { key: 'b' }] },
          { id: 'p2', fields: [{ key: 'c' }] },
        ],
      }),
    )

    expect(counts.anchorValues).toBe(2)
    expect(counts.panelValues).toBe(3)
  })

  // ⚠ 漏掉的槽会被绑点面板当成「行数由用户手工增删」，于是摆出一个
  //   加了也喂不到任何东西的「新增一行」
  it('一个实体都没有的槽也出现在表里、值为 0', () => {
    expect(twinRowCounts(normalizeTwinConfig({}))).toEqual({
      partValues: 0,
      anchorValues: 0,
      panelValues: 0,
      arrowValues: 0,
      flowValues: 0,
      partFieldValues: 0,
    })
  })

  it('能量流一条流算一行，不按子槽数翻倍', () => {
    const counts = twinRowCounts(
      normalizeTwinConfig({ flows: [{ id: 'f1' }, { id: 'f2' }] }),
    )

    expect(counts.flowValues).toBe(2)
  })
})

// 两边各算各的顺序时，每一行都会有值、但全都接错了对象
describe('推导出的顺序与缝合读值的顺序逐行相同', () => {
  it('锚点：第 i 行喂给第 i 个锚点', () => {
    const rows = twinBindingRows(CONFIG).filter(
      (row) => row.slotKey === 'anchorValues',
    )
    const stitched = stitchAnchorValues(CONFIG.anchors, [
      { value: 1 },
      { value: 2 },
    ])
    expect(rows.map((row) => row.entityId)).toEqual(Object.keys(stitched))
  })

  it('信息牌：第 i 行喂给摊平后的第 i 个字段', () => {
    const rows = twinBindingRows(CONFIG).filter(
      (row) => row.slotKey === 'panelValues',
    )
    const stitched = stitchPanelValues(flattenPanelFields(CONFIG.panels), [
      { value: 1 },
    ])
    expect(rows.map((row) => row.entityId)).toEqual(Object.keys(stitched))
  })

  // ⚠ 部件的行号跳过没配染色的那些：两边只要有一边按 config.parts 的下标数，
  //   给中间某个部件关掉染色就会让它之后的每一行改喂前一个部件
  it('部件：第 i 行喂给配了染色的第 i 个部件', () => {
    const mixed = normalizeTwinConfig({
      parts: [
        { id: 'skip1' },
        { id: 'tint1', tint: { mode: 'stops' } },
        { id: 'skip2' },
        { id: 'tint2', tint: { mode: 'stops' } },
      ],
    })
    const rows = twinBindingRows(mixed).filter(
      (row) => row.slotKey === 'partValues',
    )
    const stitched = stitchPartValues(mixed.parts, [{ value: 1 }, { value: 2 }])

    expect(rows.map((row) => row.entityId)).toEqual(Object.keys(stitched))
    expect(rows.map((row) => row.fieldKey)).toEqual([
      'partValues[0].value',
      'partValues[1].value',
    ])
  })

  // 关掉中间那个部件的染色，后面那个的绑定要跟着搬上来
  it('给中间的部件关掉染色，它之后的绑定整体前移', () => {
    const before = normalizeTwinConfig({
      parts: [
        { id: 'one', tint: { mode: 'stops' } },
        { id: 'two', tint: { mode: 'stops' } },
      ],
    })
    const after = normalizeTwinConfig({
      parts: [{ id: 'one' }, { id: 'two', tint: { mode: 'stops' } }],
    })
    const moved = remapTwinBindings(before, after, [
      binding('partValues[0].value'),
      binding('partValues[1].value'),
    ])

    expect(moved.map((item) => item.fieldKey)).toEqual(['partValues[0].value'])
  })
})

// 编辑器每一次写配置都过 remapTwinBindings，不挑「看起来会影响绑定」的动作调
describe('整份配置对比后的重映射', () => {
  it('删一个锚点，箭头与能量流的绑定各自也跟着搬', () => {
    const before = normalizeTwinConfig({
      anchors: [{ id: 'a1' }, { id: 'a2' }],
      arrows: [{ id: 'ar1' }, { id: 'ar2' }],
    })
    const after = normalizeTwinConfig({
      anchors: [{ id: 'a2' }],
      arrows: [{ id: 'ar2' }],
    })
    const moved = remapTwinBindings(before, after, [
      binding('anchorValues[1].value'),
      binding('arrowValues[1].value'),
    ])

    expect(moved.map((item) => item.fieldKey)).toEqual([
      'anchorValues[0].value',
      'arrowValues[0].value',
    ])
  })

  // ⚠ 最容易漏的一个：牌的值按摊平后的字段序对齐，插一个字段会推动后面所有牌
  it('给前一张牌插一个字段，后一张牌的绑定整体后移', () => {
    const before = normalizeTwinConfig({
      panels: [
        { id: 'p1', fields: [{ key: 'a' }] },
        { id: 'p2', fields: [{ key: 'b' }] },
      ],
    })
    const after = normalizeTwinConfig({
      panels: [
        { id: 'p1', fields: [{ key: 'a' }, { key: 'a2' }] },
        { id: 'p2', fields: [{ key: 'b' }] },
      ],
    })
    const moved = remapTwinBindings(before, after, [
      binding('panelValues[0].value'),
      binding('panelValues[1].value'),
    ])

    // 原来第 1 行喂 p2::b，插字段之后它该是第 2 行
    const byKey = new Map(moved.map((item) => [item.fieldKey, item.nodeKey]))
    expect(byKey.get('panelValues[2].value')).toBe('panelValues[1].value')
    expect(byKey.get('panelValues[0].value')).toBe('panelValues[0].value')
  })

  it('配置没变时绑定一条都不动', () => {
    const bindings = [
      binding('anchorValues[0].value'),
      binding('panelValues[0].value'),
    ]

    expect(remapTwinBindings(CONFIG, CONFIG, bindings)).toEqual(bindings)
  })

  it('删掉整张牌，牌上每个字段的绑定一起消失', () => {
    const before = normalizeTwinConfig({
      panels: [{ id: 'p1', fields: [{ key: 'a' }, { key: 'b' }] }],
    })
    const after = normalizeTwinConfig({ panels: [] })

    expect(
      remapTwinBindings(before, after, [
        binding('panelValues[0].value'),
        binding('panelValues[1].value'),
      ]),
    ).toEqual([])
  })
})

describe('实体删掉之后的重映射', () => {
  const bindings = [
    binding('anchorValues[0].value'),
    binding('anchorValues[1].value'),
    binding('anchorValues[2].value'),
  ]

  it('删中间一个：它之后的绑定整体前移，仍然喂原来那个锚点', () => {
    const moved = remapBindingRows(
      'anchorValues',
      ['a1', 'a2', 'a3'],
      ['a1', 'a3'],
      bindings,
    )
    // 原来喂 a3 的是第 2 行，现在该是第 1 行
    expect(moved.map((item) => item.fieldKey)).toEqual([
      'anchorValues[0].value',
      'anchorValues[1].value',
    ])
    expect(moved[1]?.nodeKey).toBe('anchorValues[2].value')
  })

  it('被删实体自己那条整条丢掉，不留着占一个行号', () => {
    const moved = remapBindingRows(
      'anchorValues',
      ['a1', 'a2'],
      ['a2'],
      [binding('anchorValues[0].value'), binding('anchorValues[1].value')],
    )
    expect(moved).toHaveLength(1)
    expect(moved[0]?.nodeKey).toBe('anchorValues[1].value')
  })

  it('重排也跟着搬：绑定始终跟着实体走', () => {
    const moved = remapBindingRows(
      'anchorValues',
      ['a1', 'a2', 'a3'],
      ['a3', 'a1', 'a2'],
      bindings,
    )
    const byKey = new Map(moved.map((item) => [item.fieldKey, item.nodeKey]))
    expect(byKey.get('anchorValues[0].value')).toBe('anchorValues[2].value')
    expect(byKey.get('anchorValues[1].value')).toBe('anchorValues[0].value')
  })

  it('别的槽的绑定原样不动', () => {
    const moved = remapBindingRows(
      'anchorValues',
      ['a1'],
      [],
      [binding('arrowValues[0].value'), binding('anchorValues[0].value')],
    )
    expect(moved.map((item) => item.fieldKey)).toEqual(['arrowValues[0].value'])
  })

  it('形状不认识的 fieldKey 原样留着，不误删别人的数据', () => {
    const moved = remapBindingRows('anchorValues', [], [], [binding('title')])
    expect(moved.map((item) => item.fieldKey)).toEqual(['title'])
  })

  it('新增实体不动任何既有绑定', () => {
    const moved = remapBindingRows(
      'anchorValues',
      ['a1'],
      ['a1', 'a2'],
      [binding('anchorValues[0].value')],
    )
    expect(moved.map((item) => item.fieldKey)).toEqual([
      'anchorValues[0].value',
    ])
  })

  it('能量流的两个子槽一起搬，不只搬强度那一条', () => {
    const moved = remapBindingRows(
      'flowValues',
      ['f1', 'f2'],
      ['f2'],
      [
        binding('flowValues[0].intensity'),
        binding('flowValues[1].intensity'),
        binding('flowValues[1].active'),
      ],
    )
    expect(moved.map((item) => item.fieldKey)).toEqual([
      'flowValues[0].intensity',
      'flowValues[0].active',
    ])
  })
})

/**
 * ⚠ 这一组守的是「只看选中的那一个」。给的必须是**文档序的行号**，不是过滤后
 * 的位置——数组绑定的 fieldKey 由行号拼出来，重新编号会让每一条绑定都改喂另一
 * 个实体，而界面上看不出任何异常。
 */
describe('某个实体占了哪几行', () => {
  const MANY = normalizeTwinConfig({
    anchors: [
      { id: 'a1', name: '进口' },
      { id: 'a2', name: '出口' },
    ],
    panels: [
      { id: 'p1', name: '泵组', fields: [{ key: 'temp', label: '温度' }] },
      {
        id: 'p2',
        name: '风机',
        fields: [
          { key: 'rpm', label: '转速' },
          { key: 'amp', label: '电流' },
        ],
      },
    ],
    arrows: [{ id: 'ar1', name: '进气' }],
  })

  it('⚠ 信息牌摊成多行，一张牌的全部字段都要给上', () => {
    expect(twinRowsOfEntity(MANY, 'panels', 'p2')).toEqual({
      panelValues: [1, 2],
    })
  })

  it('⚠ 给的是文档序行号，不是过滤后重排的位置', () => {
    // p2 的两个字段在摊平后排第 2、3 位；按过滤后编号会变成 0、1
    const rows = twinRowsOfEntity(MANY, 'panels', 'p2')?.panelValues ?? []
    const all = twinBindingRows(MANY).filter(
      (row) => row.slotKey === 'panelValues',
    )
    expect(rows.map((index) => all[index]?.entityId)).toEqual([
      'p2::rpm',
      'p2::amp',
    ])
  })

  it('一个实体一行的那几类，只给它自己那一行', () => {
    expect(twinRowsOfEntity(MANY, 'anchors', 'a2')).toEqual({
      anchorValues: [1],
    })
  })

  it('⚠ 只出现自己那个槽：别的槽整段不该摆出来', () => {
    expect(Object.keys(twinRowsOfEntity(MANY, 'arrows', 'ar1') ?? {})).toEqual([
      'arrowValues',
    ])
  })

  it('⚠ 不取数的实体回 null，与「取数但一行都没有」分开', () => {
    // 前者该退回整段孪生的全部绑定，后者该说这个实体没有可绑的字段
    expect(twinRowsOfEntity(MANY, 'cameras', 'whatever')).toBeNull()
  })

  // 部件占两个槽：染色一行，详情字段每个字段一行。没配的给空表，说的是
  // 「这个部件没有可绑的字段」
  it('没配染色的部件给一张空表，配了的才有行', () => {
    const mixed = normalizeTwinConfig({
      parts: [{ id: 'plain' }, { id: 'tinted', tint: { mode: 'stops' } }],
    })

    expect(twinRowsOfEntity(mixed, 'parts', 'plain')).toEqual({
      partValues: [],
      partFieldValues: [],
    })
    expect(twinRowsOfEntity(mixed, 'parts', 'tinted')).toEqual({
      partValues: [0],
      partFieldValues: [],
    })
  })

  it('没有字段的信息牌给一张空表，不是 null', () => {
    const bare = normalizeTwinConfig({
      panels: [{ id: 'p9', name: '空牌', fields: [] }],
    })
    expect(twinRowsOfEntity(bare, 'panels', 'p9')).toEqual({ panelValues: [] })
  })

  it('⚠ id 前缀相同的实体不许互相串行', () => {
    const tricky = normalizeTwinConfig({
      anchors: [
        { id: 'a', name: '甲' },
        { id: 'a1', name: '乙' },
      ],
    })
    expect(twinRowsOfEntity(tricky, 'anchors', 'a')).toEqual({
      anchorValues: [0],
    })
  })
})
