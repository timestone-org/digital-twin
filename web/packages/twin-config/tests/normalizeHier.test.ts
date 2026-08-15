/**
 * @fileoverview 契约：钻取节点的归一化幂等、全字段非可选、id 按下标铸。
 * ⚠ 归一化跑两遍必须逐字段相同：数组绑定的文档序对齐正是靠这一条成立的。
 */
import { describe, expect, it } from 'vitest'

import { buildHierTree } from '../src/hierTree'
import { normalizeTwinConfig } from '../src/normalize'
import { normalizeHierNode } from '../src/normalizeHier'

describe('钻取节点归一化', () => {
  it('缺字段一律补成具体缺省值，输出里没有 undefined', () => {
    expect(normalizeHierNode({}, 3)).toEqual({
      id: 'hier-3',
      parentId: null,
      name: '',
      order: 3,
      icon: '',
      nodes: [],
      view: null,
      cameraId: '',
      fields: [],
      summaryFieldKeys: [],
      title: '',
      hideChildList: false,
    })
  })

  it('不是对象的条目整条丢掉', () => {
    expect(normalizeHierNode('厂区', 0)).toBeNull()
    expect(normalizeTwinConfig({ hierNodes: [1, null, {}] }).hierNodes).toEqual(
      [expect.objectContaining({ id: 'hier-2' })],
    )
  })

  it('空白 parentId 视同顶层，不是一条指向空串的悬空引用', () => {
    expect(normalizeHierNode({ parentId: '   ' }, 0)?.parentId).toBeNull()
  })

  it('取景快照缺位逐项回退，视野夹进视点同一套区间', () => {
    const node = normalizeHierNode(
      { view: { position: [1, 'x', 3], target: [0, 0, 0], fov: 999 } },
      0,
    )

    expect(node?.view).toEqual({
      position: [1, 0, 3],
      target: [0, 0, 0],
      fov: 179,
    })
  })

  it('取景不是对象时当没配', () => {
    expect(normalizeHierNode({ view: 'front' }, 0)?.view).toBeNull()
  })

  it('order 取不到时按文档序下标顶上', () => {
    expect(normalizeHierNode({ order: 'soon' }, 7)?.order).toBe(7)
  })

  it('字段与摘要键走与信息牌同一套清洗：去空白、丢空串、去重', () => {
    const node = normalizeHierNode(
      {
        fields: [{ label: ' 功率 ' }, 'x'],
        summaryFieldKeys: [' a ', 'a', ''],
      },
      0,
    )

    expect(node?.fields).toEqual([
      expect.objectContaining({ key: 'field-0', label: '功率' }),
    ])
    expect(node?.summaryFieldKeys).toEqual(['a'])
  })

  it('跑两遍与跑一遍逐字段相同', () => {
    const raw = {
      hierNodes: [
        { name: '厂区', nodes: [' Plant ', 'Plant'] },
        { id: 'shop', parentId: '厂区', order: -1e9, hideChildList: 1 },
      ],
    }
    const once = normalizeTwinConfig(raw)

    expect(normalizeTwinConfig(once)).toEqual(once)
  })

  it('id 重复时建树不会因为重复访问而无限展开', () => {
    const nodes = normalizeTwinConfig({
      hierNodes: [
        { id: 'root', name: '根' },
        { id: 'dup', parentId: 'root', name: '甲' },
        { id: 'dup', parentId: 'root', name: '乙' },
      ],
    }).hierNodes
    const tree = buildHierTree(nodes)

    expect(tree[0]?.children.map((item) => item.node.name)).toEqual(['甲'])
  })
})
