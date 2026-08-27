/**
 * @fileoverview 契约：部件详情字段的绑定行、行名、增删后的重映射、缝合读值，
 * 以及点击动作与详情配错时的四条诊断。
 *
 * ⚠ 派生绑定行与缝合读值必须逐行同序：两边各算各的时每一行都会有值、
 * 但全都接错了字段，界面上看不出来。
 */
import { describe, expect, it } from 'vitest'

import {
  remapTwinBindings,
  twinBindingRows,
  twinRowLabels,
  twinRowsOfEntity,
} from '../src/bindingRows'
import {
  TWIN_PART_FIELD_BINDING_KEY,
  partFieldRowFieldKey,
} from '../src/constants'
import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/normalize'
import { flattenPartFields } from '../src/partFields'
import { stitchPartFieldValues } from '../src/twinMath'
import type { TwinConfig } from '../src/types'

function configOf(raw: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig(raw)
}

const TWO_PARTS = {
  parts: [
    {
      id: 'shop',
      name: '车间',
      detail: { fields: [{ key: 'p', label: '功率' }] },
    },
    {
      id: 'pump',
      name: '泵组',
      detail: { fields: [{ key: 'p', label: '功率' }, { key: 'q' }] },
    },
  ],
}

describe('部件详情绑定行', () => {
  it('每个字段一行，fieldKey 按扁平化后的文档序', () => {
    const rows = twinBindingRows(configOf(TWO_PARTS)).filter(
      (row) => row.slotKey === TWIN_PART_FIELD_BINDING_KEY,
    )

    expect(rows.map((row) => row.fieldKey)).toEqual([
      partFieldRowFieldKey(0),
      partFieldRowFieldKey(1),
      partFieldRowFieldKey(2),
    ])
  })

  it('行名是「部件名 · 字段标签」，标签空着退回字段 key', () => {
    const labels = twinRowLabels(configOf(TWO_PARTS))

    expect(labels[partFieldRowFieldKey(0)]?.title).toBe('车间 · 功率')
    expect(labels[partFieldRowFieldKey(2)]?.title).toBe('泵组 · q')
  })

  it('部件名空着时行名退回部件 id', () => {
    const labels = twinRowLabels(
      configOf({
        parts: [{ id: 'p1', detail: { fields: [{ key: 'a', label: 'A' }] } }],
      }),
    )

    expect(labels[partFieldRowFieldKey(0)]).toEqual({
      title: 'p1 · A',
      id: 'p1::a',
    })
  })

  it('详情字段与状态染色是两个槽，行号各数各的', () => {
    const config = configOf({
      parts: [
        {
          id: 'a',
          tint: { mode: 'stops' },
          detail: { fields: [{ key: 'x' }] },
        },
        { id: 'b', detail: { fields: [{ key: 'y' }] } },
      ],
    })

    expect(twinRowsOfEntity(config, 'parts', 'b')).toEqual({
      partValues: [],
      partFieldValues: [1],
    })
  })

  it('配了字段却不弹窗的部件照样占行——按动作过滤会把绑定整片丢掉', () => {
    const rows = twinBindingRows(
      configOf({
        parts: [
          {
            id: 'p1',
            click: { near: 'none' },
            detail: { fields: [{ key: 'a' }] },
          },
        ],
      }),
    ).filter((row) => row.slotKey === TWIN_PART_FIELD_BINDING_KEY)

    expect(rows).toHaveLength(1)
  })
})

describe('部件详情绑定重映射', () => {
  it('删掉前一个部件后，后面那些行整体前移，绑定跟着搬', () => {
    const before = configOf(TWO_PARTS)
    const after = configOf({ parts: [TWO_PARTS.parts[1]] })
    const bindings = [
      { fieldKey: partFieldRowFieldKey(1), pointId: 'x' },
      { fieldKey: partFieldRowFieldKey(2), pointId: 'y' },
    ]

    expect(remapTwinBindings(before, after, bindings)).toEqual([
      { fieldKey: partFieldRowFieldKey(0), pointId: 'x' },
      { fieldKey: partFieldRowFieldKey(1), pointId: 'y' },
    ])
  })

  it('字段没了的那一行整条丢弃，不留着把后面又推错一格', () => {
    const before = configOf(TWO_PARTS)
    const after = configOf({
      parts: [
        TWO_PARTS.parts[0],
        { ...TWO_PARTS.parts[1], detail: { fields: [{ key: 'q' }] } },
      ],
    })
    const bindings = [
      { fieldKey: partFieldRowFieldKey(1), pointId: 'gone' },
      { fieldKey: partFieldRowFieldKey(2), pointId: 'kept' },
    ]

    expect(remapTwinBindings(before, after, bindings)).toEqual([
      { fieldKey: partFieldRowFieldKey(1), pointId: 'kept' },
    ])
  })
})

describe('部件详情实时值缝合', () => {
  it('第 i 行喂扁平化后的第 i 个字段', () => {
    const config = configOf(TWO_PARTS)
    const values = stitchPartFieldValues(flattenPartFields(config.parts), [
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
    const config = configOf(TWO_PARTS)
    const first = stitchPartFieldValues(flattenPartFields(config.parts), [])
    const second = stitchPartFieldValues(flattenPartFields(config.parts), null)

    expect(first).toBe(second)
  })

  it('部件缺席时不炸，直接给空', () => {
    expect(stitchPartFieldValues(undefined, [{ value: 1 }])).toEqual({})
  })
})

describe('部件点击与详情诊断', () => {
  it('远距取景指到已删的视点时报出来，否则只表现为飞错了地方', () => {
    const issues = collectTwinConfigIssues(
      configOf({ parts: [{ id: 'p1', click: { cameraId: 'gone' } }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'dangling-part-camera',
        entityId: 'p1',
        path: 'parts[0].click.cameraId',
      }),
    ])
  })

  it('选了「飞到取景」却没存机位也没挑视点时报出来', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          {
            id: 'p1',
            click: { far: 'view' },
            clickDistance: { farThreshold: { ref: 'orbit', value: 20 } },
          },
        ],
      }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'part-focus-no-target',
        entityId: 'p1',
        path: 'parts[0].click.far',
      }),
    ])
  })

  it('存了机位就不报「没配全」', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          {
            id: 'p1',
            click: { far: 'view', view: { position: [1, 2, 3] } },
            clickDistance: { farThreshold: { ref: 'orbit', value: 20 } },
          },
        ],
      }),
    )

    expect(issues).toEqual([])
  })

  // ⚠ 没有分界就没有远档：配好的机位永远飞不到，而两处分别看都挑不出毛病
  it('配了远距取景却没配远近分界时报出来', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          { id: 'p1', click: { far: 'view', view: { position: [1, 2, 3] } } },
        ],
      }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'part-far-unreachable',
        entityId: 'p1',
        path: 'parts[0].clickDistance.farThreshold',
      }),
    ])
  })

  it('配了详情字段却不弹窗时报出来——那些字段占着绑定行却永远看不到', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          {
            id: 'p1',
            click: { near: 'none' },
            detail: { fields: [{ key: 'a' }] },
          },
        ],
      }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'part-detail-unreachable',
        entityId: 'p1',
        path: 'parts[0].click.near',
      }),
    ])
  })

  it('要弹窗却一个字段都没配时报出来', () => {
    const issues = collectTwinConfigIssues(
      configOf({ parts: [{ id: 'p1', click: { near: 'detail' } }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'part-detail-empty',
        entityId: 'p1',
        path: 'parts[0].detail.fields',
      }),
    ])
  })

  it('配好字段又开了弹窗就一条都不报', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          {
            id: 'p1',
            click: { near: 'detail' },
            detail: { fields: [{ key: 'a' }] },
          },
        ],
      }),
    )

    expect(issues).toEqual([])
  })

  it('远档留在缺省的「框进画面」时不因为没分界报警', () => {
    const issues = collectTwinConfigIssues(configOf({ parts: [{ id: 'p1' }] }))

    expect(issues).toEqual([])
  })
})
