/**
 * @fileoverview 契约：钻取树摊成行时的缩进、折叠、能不能挪，以及落点合法性。
 * ⚠ 落点判定必须先滤掉自己的子树：拖进去会成环，而成环的那几层在钻取里整片消失。
 */
import { normalizeTwinConfig, type TwinHierNode } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  buildHierRows,
  canDropHierOn,
  hierChildCount,
  hierParentCandidates,
} from '@/pages/TwinEditor/scripts/hierRows'

function nodesOf(raw: unknown[]): TwinHierNode[] {
  return normalizeTwinConfig({ hierNodes: raw }).hierNodes
}

const NONE: ReadonlySet<string> = new Set()

const TREE = nodesOf([
  { id: 'plant', name: '厂区' },
  { id: 'shopA', parentId: 'plant', name: 'A 车间', order: 0 },
  { id: 'shopB', parentId: 'plant', name: 'B 车间', order: 1 },
  { id: 'pump', parentId: 'shopA', name: '泵组', fields: [{ key: 'p' }] },
])

describe('钻取行清单', () => {
  it('按树序摊平，缩进层数就是深度', () => {
    const rows = buildHierRows(TREE, NONE, NONE)

    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ['plant', 0],
      ['shopA', 1],
      ['pump', 2],
      ['shopB', 1],
    ])
  })

  it('折叠起来的那一支不往下摊', () => {
    const rows = buildHierRows(TREE, new Set(['shopA']), NONE)

    expect(rows.map((row) => row.id)).toEqual(['plant', 'shopA', 'shopB'])
    expect(rows[1]?.collapsed).toBe(true)
  })

  it('有子层报子层数，叶子报字段数', () => {
    const rows = buildHierRows(TREE, NONE, NONE)

    expect(rows[0]?.meta).toBe('2 子层')
    expect(rows[2]?.meta).toBe('1 字段')
  })

  it('名字空着退回 id，没配图标退回缺省图标', () => {
    const rows = buildHierRows(nodesOf([{ id: 'n1' }]), NONE, NONE)

    expect(rows[0]).toMatchObject({ label: 'n1', icon: 'folder' })
  })

  it('头一个不能上移、末一个不能下移，只看同级', () => {
    const rows = buildHierRows(TREE, NONE, NONE)

    expect(rows[1]).toMatchObject({ canMoveUp: false, canMoveDown: true })
    expect(rows[3]).toMatchObject({ canMoveUp: true, canMoveDown: false })
  })

  it('有诊断问题的行打红点', () => {
    const rows = buildHierRows(TREE, NONE, new Set(['pump']))

    expect(rows.filter((row) => row.flagged).map((row) => row.id)).toEqual([
      'pump',
    ])
  })

  it('行 key 带深度与位次，两个同 id 的节点不共用一个 key', () => {
    const rows = buildHierRows(
      nodesOf([{ id: 'dup' }, { id: 'dup' }]),
      NONE,
      NONE,
    )

    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

describe('落点合法性', () => {
  it('拖到别的支上可以', () => {
    expect(canDropHierOn(TREE, 'pump', 'shopB')).toBe(true)
  })

  it('拖进自己的子树里不行', () => {
    expect(canDropHierOn(TREE, 'plant', 'pump')).toBe(false)
  })

  it('拖到自己身上不行', () => {
    expect(canDropHierOn(TREE, 'pump', 'pump')).toBe(false)
  })

  it('没有在拖任何东西时一律不接', () => {
    expect(canDropHierOn(TREE, '', 'plant')).toBe(false)
  })

  it('已经是顶层的节点再拖到顶层落区没有意义', () => {
    expect(canDropHierOn(TREE, 'plant', null)).toBe(false)
  })

  it('非顶层的节点可以拖到顶层落区', () => {
    expect(canDropHierOn(TREE, 'pump', null)).toBe(true)
  })
})

describe('上一层候选', () => {
  it('候选里没有自己，也没有自己的子树', () => {
    expect(hierParentCandidates(TREE, 'plant').map((item) => item.id)).toEqual(
      [],
    )
  })

  it('别的支照常在候选里', () => {
    expect(hierParentCandidates(TREE, 'pump').map((item) => item.id)).toEqual([
      'plant',
      'shopA',
      'shopB',
    ])
  })
})

describe('下级条数', () => {
  it('数直接下级，不数孙层', () => {
    expect(hierChildCount(TREE, 'plant')).toBe(2)
    expect(hierChildCount(TREE, 'pump')).toBe(0)
  })
})
