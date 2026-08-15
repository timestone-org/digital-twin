/**
 * @fileoverview 契约：钻取字段的绑定行、行名、增删后的重映射、缝合读值，
 * 以及归一化吞不掉的三类钻取配置错。
 *
 * ⚠ 派生绑定行与缝合读值必须逐行同序：两边各算各的时每一行都会有值、
 * 但全都接错了字段，界面上看不出来。
 */
import { describe, expect, it } from 'vitest'

import {
  remapTwinBindings,
  twinBindingRows,
  twinRowLabels,
} from '../src/bindingRows'
import { TWIN_HIER_BINDING_KEY, hierRowFieldKey } from '../src/constants'
import { flattenHierFields } from '../src/hierTree'
import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/normalize'
import { stitchHierValues } from '../src/twinMath'
import type { TwinConfig } from '../src/types'

function configOf(raw: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig(raw)
}

const TWO_NODES = {
  hierNodes: [
    { id: 'shop', name: '车间', fields: [{ key: 'p', label: '功率' }] },
    {
      id: 'pump',
      parentId: 'shop',
      name: '泵组',
      fields: [{ key: 'p', label: '功率' }, { key: 'q' }],
    },
  ],
}

describe('钻取绑定行', () => {
  it('每个字段一行，fieldKey 按扁平化后的文档序', () => {
    const rows = twinBindingRows(configOf(TWO_NODES)).filter(
      (row) => row.slotKey === TWIN_HIER_BINDING_KEY,
    )

    expect(rows.map((row) => row.fieldKey)).toEqual([
      hierRowFieldKey(0),
      hierRowFieldKey(1),
      hierRowFieldKey(2),
    ])
  })

  it('行名是「节点名 · 字段标签」，标签空着退回字段 key', () => {
    const labels = twinRowLabels(configOf(TWO_NODES))

    expect(labels[hierRowFieldKey(0)]).toBe('车间 · 功率')
    expect(labels[hierRowFieldKey(2)]).toBe('泵组 · q')
  })

  it('节点名空着时行名退回节点 id', () => {
    const labels = twinRowLabels(
      configOf({
        hierNodes: [{ id: 'n1', fields: [{ key: 'a', label: 'A' }] }],
      }),
    )

    expect(labels[hierRowFieldKey(0)]).toBe('n1 · A')
  })

  it('新增槽排在四个老槽之后，老槽的行号一个都不动', () => {
    const config = configOf({
      anchors: [{ id: 'a1', name: '进口' }],
      ...TWO_NODES,
    })
    const rows = twinBindingRows(config)

    expect(rows[0]?.slotKey).toBe('anchorValues')
    expect(rows[0]?.fieldKey).toBe('anchorValues[0].value')
  })
})

describe('钻取绑定重映射', () => {
  it('删掉前一个节点后，后面那些行整体前移，绑定跟着搬', () => {
    const before = configOf(TWO_NODES)
    const after = configOf({ hierNodes: [TWO_NODES.hierNodes[1]] })
    const bindings = [
      { fieldKey: hierRowFieldKey(1), pointId: 'x' },
      { fieldKey: hierRowFieldKey(2), pointId: 'y' },
    ]

    expect(remapTwinBindings(before, after, bindings)).toEqual([
      { fieldKey: hierRowFieldKey(0), pointId: 'x' },
      { fieldKey: hierRowFieldKey(1), pointId: 'y' },
    ])
  })

  it('字段没了的那一行整条丢弃，不留着把后面又推错一格', () => {
    const before = configOf(TWO_NODES)
    const after = configOf({
      hierNodes: [
        TWO_NODES.hierNodes[0],
        { ...TWO_NODES.hierNodes[1], fields: [{ key: 'q' }] },
      ],
    })
    const bindings = [
      { fieldKey: hierRowFieldKey(1), pointId: 'gone' },
      { fieldKey: hierRowFieldKey(2), pointId: 'kept' },
    ]

    expect(remapTwinBindings(before, after, bindings)).toEqual([
      { fieldKey: hierRowFieldKey(1), pointId: 'kept' },
    ])
  })
})

describe('钻取实时值缝合', () => {
  it('第 i 行喂扁平化后的第 i 个字段', () => {
    const config = configOf(TWO_NODES)
    const values = stitchHierValues(flattenHierFields(config.hierNodes), [
      { value: 1 },
      { value: 2 },
      { value: 3 },
    ])

    expect(values).toEqual({
      'shop::p': { value: 1 },
      'pump::p': { value: 2 },
      'pump::q': { value: 3 },
    })
  })

  it('没有值的行不产出条目，全空时给同一个冻结空引用', () => {
    const config = configOf(TWO_NODES)
    const first = stitchHierValues(flattenHierFields(config.hierNodes), [])
    const second = stitchHierValues(flattenHierFields(config.hierNodes), null)

    expect(first).toBe(second)
  })

  it('节点缺席时不炸，直接给空', () => {
    expect(stitchHierValues(undefined, [{ value: 1 }])).toEqual({})
  })
})

describe('钻取配置诊断', () => {
  it('父指针指到不存在的节点时响亮报出来', () => {
    const issues = collectTwinConfigIssues(
      configOf({ hierNodes: [{ id: 'a', parentId: 'gone' }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'dangling-hier-parent',
        entityId: 'a',
        path: 'hierNodes[0].parentId',
      }),
    ])
  })

  it('父子成环的每一条都报出来——建树时它们会整片消失', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        hierNodes: [
          { id: 'a', parentId: 'b' },
          { id: 'b', parentId: 'a' },
        ],
      }),
    ).filter((issue) => issue.kind === 'hier-cycle')

    expect(issues.map((issue) => issue.entityId)).toEqual(['a', 'b'])
  })

  it('自己指自己也算成环', () => {
    const issues = collectTwinConfigIssues(
      configOf({ hierNodes: [{ id: 'a', parentId: 'a' }] }),
    ).filter((issue) => issue.kind === 'hier-cycle')

    expect(issues).toHaveLength(1)
  })

  it('一条正常的链不报环', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        hierNodes: [{ id: 'a' }, { id: 'b', parentId: 'a' }],
      }),
    )

    expect(issues).toEqual([])
  })

  it('部件的点击动作指到已删掉的层时报出来，否则只表现为点了没反应', () => {
    const issues = collectTwinConfigIssues(
      configOf({ parts: [{ id: 'p1', clickHierNode: 'gone' }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'dangling-hier-node',
        entityId: 'p1',
        path: 'parts[0].clickHierNode',
      }),
    ])
  })

  it('钻取节点 id 重复也报出来', () => {
    const issues = collectTwinConfigIssues(
      configOf({ hierNodes: [{ id: 'a' }, { id: 'a' }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({ kind: 'duplicate-id', entityId: 'a' }),
    ])
  })
})
