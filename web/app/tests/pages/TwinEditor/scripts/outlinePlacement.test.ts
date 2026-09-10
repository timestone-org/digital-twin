/** @fileoverview 相对排序在各实体分组中的方向、边界与归属。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'
import { placeOutlineEntity } from '@/pages/TwinEditor/scripts/outlinePlacement'
import type { TwinEntityKind } from '@/pages/TwinEditor/scripts/types'

const kinds: TwinEntityKind[] = [
  'parts',
  'anchors',
  'cameras',
  'panels',
  'arrows',
  'flows',
]

describe('相对排序', () => {
  it.each(kinds)('%s 支持跨多项插入', (kind) => {
    const config = normalizeTwinConfig({
      [kind]: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    })
    const next = placeOutlineEntity(config, {
      kind,
      id: 'a',
      targetId: 'd',
      position: 'after',
    })
    expect(next[kind].map((item) => item.id)).toEqual(['b', 'c', 'd', 'a'])
  })
  it.each([
    ['a', 'd', 'before', ['b', 'c', 'a', 'd']],
    ['d', 'a', 'after', ['a', 'd', 'b', 'c']],
    ['d', 'a', 'before', ['d', 'a', 'b', 'c']],
    ['a', 'b', 'before', ['a', 'b', 'c', 'd']],
  ] as const)('%s 放在 %s 的 %s', (id, targetId, position, expected) => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    })
    const next = placeOutlineEntity(config, {
      kind: 'anchors',
      id,
      targetId,
      position,
    })
    expect(next.anchors.map((item) => item.id)).toEqual(expected)
  })
  it.each([
    ['a', 'a'],
    ['missing', 'a'],
    ['a', 'missing'],
  ])('无效移动 %s → %s 保持原配置', (id, targetId) => {
    const config = normalizeTwinConfig({ anchors: [{ id: 'a' }] })
    expect(
      placeOutlineEntity(config, {
        kind: 'anchors',
        id,
        targetId,
        position: 'after',
      }),
    ).toBe(config)
  })
})
