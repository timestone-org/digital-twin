/**
 * @fileoverview 契约：部件从属关系的四支纯函数，以及层级带来的三条新诊断与
 * 两条改了口径的旧诊断。
 *
 * ⚠ 成环的那几条是这份用例的重点：落库的 JSON 是用户可控的，任何一支不防环就是
 * 栈溢出，而栈溢出的表现是整块大屏白屏，配置面板上看不出哪一条配错了。
 */
import { describe, expect, it } from 'vitest'

import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/normalize'
import {
  hasFieldedDescendant,
  partAncestors,
  partAssembly,
  partChildren,
  partDetailReachable,
  partOnParentCycle,
} from '../src/partTree'
import type { TwinConfig, TwinPart } from '../src/types'

function configOf(raw: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig(raw)
}

function partsOf(raw: Record<string, unknown>[]): TwinPart[] {
  return configOf({ parts: raw }).parts
}

/** 一台机组：主机下面还有两级，另有三个平级子件。 */
const UNIT = partsOf([
  { id: 'unit', name: '机组' },
  { id: 'air', name: '压缩主机', parentId: 'unit' },
  { id: 'rotor', name: '转子', parentId: 'air' },
  { id: 'seal', name: '密封', parentId: 'air' },
  { id: 'motor', name: '电机', parentId: 'unit' },
  { id: 'tank', name: '储气罐', parentId: 'unit' },
])

describe('直接子件', () => {
  it('按文档序给出，空串给全部顶层部件', () => {
    expect(partChildren(UNIT, 'unit').map((part) => part.id)).toEqual([
      'air',
      'motor',
      'tank',
    ])
    expect(partChildren(UNIT, '').map((part) => part.id)).toEqual(['unit'])
  })

  it('上级指到不存在的部件时算顶层，不是凭空多一层', () => {
    const parts = partsOf([{ id: 'a', parentId: 'ghost' }])

    expect(partChildren(parts, '').map((part) => part.id)).toEqual(['a'])
    expect(partChildren(parts, 'ghost')).toEqual([])
  })

  it('上级指向自己时算顶层，而不是自己当自己的子件', () => {
    const parts = partsOf([{ id: 'a', parentId: 'a' }])

    expect(partChildren(parts, '').map((part) => part.id)).toEqual(['a'])
    expect(partChildren(parts, 'a')).toEqual([])
  })
})

describe('装配清单', () => {
  it('深度优先、同层按文档序，第一项是打开的那个部件自己', () => {
    expect(
      partAssembly(UNIT, 'unit').map((node) => [node.part.id, node.depth]),
    ).toEqual([
      ['unit', 0],
      ['air', 1],
      ['rotor', 2],
      ['seal', 2],
      ['motor', 1],
      ['tank', 1],
    ])
  })

  it('同层最后一个带 isLast，连接轨据它把竖线收成半截', () => {
    const flags = partAssembly(UNIT, 'unit').map((node) => [
      node.part.id,
      node.isLast,
    ])

    expect(flags).toEqual([
      ['unit', true],
      ['air', false],
      ['rotor', false],
      ['seal', true],
      ['motor', false],
      ['tank', true],
    ])
  })

  it('从中间那一层打开时只列它自己这棵子树', () => {
    expect(partAssembly(UNIT, 'air').map((node) => node.part.id)).toEqual([
      'air',
      'rotor',
      'seal',
    ])
  })

  it('部件不存在时给空数组', () => {
    expect(partAssembly(UNIT, 'ghost')).toEqual([])
  })

  it('成环时断在重复那一环，既不栈溢出也不重复列一遍', () => {
    const parts = partsOf([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ])

    expect(partAssembly(parts, 'a').map((node) => node.part.id)).toEqual([
      'a',
      'b',
    ])
  })
})

describe('祖先链', () => {
  it('由近及远', () => {
    expect(partAncestors(UNIT, 'rotor').map((part) => part.id)).toEqual([
      'air',
      'unit',
    ])
    expect(partAncestors(UNIT, 'unit')).toEqual([])
  })

  it('撞上悬空 id 就地收住', () => {
    const parts = partsOf([
      { id: 'a', parentId: 'ghost' },
      { id: 'b', parentId: 'a' },
    ])

    expect(partAncestors(parts, 'b').map((part) => part.id)).toEqual(['a'])
  })

  it('自指不产出祖先', () => {
    expect(partAncestors(partsOf([{ id: 'a', parentId: 'a' }]), 'a')).toEqual(
      [],
    )
  })
})

describe('成环判定', () => {
  it('直接指向自己算成环', () => {
    expect(partOnParentCycle(partsOf([{ id: 'a', parentId: 'a' }]), 'a')).toBe(
      true,
    )
  })

  it('绕一圈回到自己算成环，环上每一个都算', () => {
    const parts = partsOf([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ])

    expect(partOnParentCycle(parts, 'a')).toBe(true)
    expect(partOnParentCycle(parts, 'b')).toBe(true)
  })

  it('正常层级与悬空上级都不算成环', () => {
    expect(partOnParentCycle(UNIT, 'rotor')).toBe(false)
    expect(
      partOnParentCycle(partsOf([{ id: 'a', parentId: 'ghost' }]), 'a'),
    ).toBe(false)
  })
})

describe('详情可达性', () => {
  const TREE = partsOf([
    { id: 'unit', click: { near: 'detail' } },
    { id: 'air', parentId: 'unit' },
    { id: 'rotor', parentId: 'air' },
    { id: 'lonely' },
  ])

  it('自己弹得出来就算可达', () => {
    expect(partDetailReachable(TREE, 'unit')).toBe(true)
  })

  it('祖先弹得出来就算可达——子件是从父件的装配栏里带出来看的', () => {
    expect(partDetailReachable(TREE, 'air')).toBe(true)
    expect(partDetailReachable(TREE, 'rotor')).toBe(true)
  })

  it('自己不弹、也没有弹得出来的上级就是不可达', () => {
    expect(partDetailReachable(TREE, 'lonely')).toBe(false)
  })
})

describe('后代取不取数', () => {
  it('后代里有配了字段的就算有', () => {
    const parts = partsOf([
      { id: 'unit' },
      { id: 'air', parentId: 'unit', detail: { fields: [{ key: 'a' }] } },
    ])

    expect(hasFieldedDescendant(parts, 'unit')).toBe(true)
  })

  it('只有自己配了字段不算——那不是纯容器', () => {
    const parts = partsOf([
      { id: 'unit', detail: { fields: [{ key: 'a' }] } },
      { id: 'air', parentId: 'unit' },
    ])

    expect(hasFieldedDescendant(parts, 'unit')).toBe(false)
  })
})

describe('层级诊断', () => {
  it('上级指到不存在的部件时报出来，否则它安静地变回顶层', () => {
    const issues = collectTwinConfigIssues(
      configOf({ parts: [{ id: 'a', parentId: 'ghost' }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'dangling-part-parent',
        entityId: 'a',
        path: 'parts[0].parentId',
      }),
    ])
  })

  it('上级指向自己时报成环，且不当成悬空', () => {
    const issues = collectTwinConfigIssues(
      configOf({ parts: [{ id: 'a', parentId: 'a' }] }),
    )

    expect(issues).toEqual([
      expect.objectContaining({ kind: 'part-parent-cycle', entityId: 'a' }),
    ])
  })

  it('绕一圈回到自己时环上每一个都报', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          { id: 'a', parentId: 'b' },
          { id: 'b', parentId: 'a' },
        ],
      }),
    )

    expect(issues.map((issue) => [issue.kind, issue.entityId])).toEqual([
      ['part-parent-cycle', 'a'],
      ['part-parent-cycle', 'b'],
    ])
  })

  it('压过五层时报太深', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          { id: 'l0' },
          { id: 'l1', parentId: 'l0' },
          { id: 'l2', parentId: 'l1' },
          { id: 'l3', parentId: 'l2' },
          { id: 'l4', parentId: 'l3' },
          { id: 'l5', parentId: 'l4' },
        ],
      }),
    )

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'part-parent-too-deep',
        entityId: 'l5',
        path: 'parts[5].parentId',
      }),
    ])
  })

  it('子件配了字段、自己不弹窗，但上级弹得出来时不报「看不到」', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          {
            id: 'unit',
            click: { near: 'detail' },
            detail: { fields: [{ key: 'a' }] },
          },
          {
            id: 'air',
            parentId: 'unit',
            detail: { fields: [{ key: 'b' }] },
          },
        ],
      }),
    )

    expect(issues).toEqual([])
  })

  it('纯容器父件自己不取数也不报「空卡片」——它靠子件的读数撑起弹窗', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          { id: 'unit', click: { near: 'detail' } },
          {
            id: 'air',
            parentId: 'unit',
            detail: { fields: [{ key: 'b' }] },
          },
        ],
      }),
    )

    expect(issues).toEqual([])
  })

  it('后代也一个字段都没有时照旧报「空卡片」', () => {
    const issues = collectTwinConfigIssues(
      configOf({
        parts: [
          { id: 'unit', click: { near: 'detail' } },
          { id: 'air', parentId: 'unit' },
        ],
      }),
    )

    expect(issues).toEqual([
      expect.objectContaining({ kind: 'part-detail-empty', entityId: 'unit' }),
    ])
  })
})
