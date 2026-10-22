/** @fileoverview 地址空间虚拟行顺序、分页入口与窗口边界。 */
import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@/pages/Collect/scripts/browseTree'
import { toNodes } from '@/pages/Collect/scripts/browseTree'
import {
  browseWindow,
  visibleBrowseRows,
} from '@/pages/Collect/scripts/browseViewport'

function node(address: string): TreeNode {
  const result = toNodes([
    {
      address,
      name: address,
      has_children: false,
      is_variable: true,
      data_type: 'float',
    },
  ])[0]
  if (result === undefined) throw new Error('节点夹具为空')
  return result
}

describe('展开行', () => {
  it('空树没有节点，根分页入口单独成行', () => {
    expect(visibleBrowseRows([], null, false)).toEqual([])
    expect(visibleBrowseRows([], 'next', true)).toEqual([
      {
        kind: 'more',
        key: 'more:[]',
        address: null,
        name: '根节点',
        isLoading: true,
        depth: 0,
      },
    ])
  })

  it('按层级顺序列出展开节点、错误和子层分页入口', () => {
    const root = node('root')
    root.isVariable = false
    root.hasChildren = true
    root.isOpen = true
    root.error = '读取失败'
    root.nextToken = 'next'
    root.children = [node('child')]
    const rows = visibleBrowseRows([root, node('sibling')], 'root-next', false)

    expect(rows.map((row) => [row.kind, row.depth, row.key])).toEqual([
      ['node', 0, 'node:["root"]'],
      ['error', 1, 'error:["root"]'],
      ['node', 1, 'node:["root","child"]'],
      ['more', 1, 'more:["root"]'],
      ['node', 0, 'node:["sibling"]'],
      ['more', 0, 'more:[]'],
    ])
  })

  it('收起节点不索引缓存的子树与继续浏览入口', () => {
    const root = node('root')
    root.children = [node('child')]
    root.nextToken = 'next'
    expect(
      visibleBrowseRows([root], null, false).map((row) => row.key),
    ).toEqual(['node:["root"]'])
  })

  it('截断子树没有游标也保留继续浏览入口', () => {
    const root = node('root')
    root.isOpen = true
    root.isIncomplete = true
    expect(
      visibleBrowseRows([root], null, false).map((row) => row.kind),
    ).toEqual(['node', 'more'])
  })

  it('多父引用共享节点时每条路径的节点、错误与续页键都唯一', () => {
    const roots = ['A', 'B'].map((address) => {
      const root = node(address)
      root.isOpen = true
      const shared = node('X')
      shared.isOpen = true
      shared.error = '读取失败'
      shared.nextToken = 'next'
      shared.children = [node('variable')]
      root.children = [shared]
      return root
    })
    const rows = visibleBrowseRows(roots, null, false)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
    const sharedRows = rows.filter(
      (row) => row.kind === 'node' && row.node.address === 'X',
    )
    expect(sharedRows.map((row) => row.key)).toEqual([
      'node:["A","X"]',
      'node:["B","X"]',
    ])
  })

  it('地址中的分隔符和引号不与另一条祖先路径碰撞', () => {
    const left = node('A/B')
    left.isOpen = true
    left.children = [node('C"')]
    const right = node('A')
    right.isOpen = true
    right.children = [node('B/C"')]
    const rows = visibleBrowseRows([left, right], null, false)
    expect(new Set(rows.map((row) => row.key)).size).toBe(4)
  })
})

describe('虚拟窗口边界', () => {
  it.each([
    [0, 0, 480, 0, 0],
    [1, 0, 480, 0, 1],
    [10000, 0, 480, 0, 21],
    [10000, 32000, 480, 994, 1021],
    [10000, 99999999, 480, 9979, 10000],
    [5, 99999999, 480, 0, 5],
    [100, -100, 96, 0, 9],
  ])('总数 %i 滚动 %i 高度 %i', (total, top, height, start, end) => {
    expect(browseWindow(total, top, height)).toEqual({ start, end })
  })
})
