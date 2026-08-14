/**
 * @fileoverview 锁住「归一化不吞、由这里响亮报出」的三类错误：重复 id、悬空部件引用、
 * gradient 规则缺区间。三样都不会让渲染报错，只会让某条规则安静地永远不生效。
 */
import { describe, expect, it } from 'vitest'

import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/types'

describe('collectTwinConfigIssues', () => {
  it('干净的配置没有问题', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'p1', nodes: ['a'] }],
      anchors: [{ id: 'a1' }],
      tints: [{ id: 't1', partIds: ['p1'] }],
    })
    expect(collectTwinConfigIssues(config)).toEqual([])
  })

  it('重复的部件 id 逐条报出，只报后出现的那个', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'p1' }, { id: 'p1' }, { id: 'p1' }],
    })
    expect(collectTwinConfigIssues(config)).toEqual([
      {
        kind: 'duplicate-id',
        entityId: 'p1',
        path: 'parts[1].id',
        detail: '同一个 id 出现两次，缝合实时值时后者会覆盖前者',
      },
      {
        kind: 'duplicate-id',
        entityId: 'p1',
        path: 'parts[2].id',
        detail: '同一个 id 出现两次，缝合实时值时后者会覆盖前者',
      },
    ])
  })

  it('锚点与染色规则的重复 id 同样报出', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }, { id: 'a1' }],
      tints: [{ id: 't1' }, { id: 't1' }],
    })
    expect(collectTwinConfigIssues(config).map((issue) => issue.path)).toEqual([
      'anchors[1].id',
      'tints[1].id',
    ])
  })

  it('悬空的部件引用带上具体槽位', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'p1' }],
      tints: [{ id: 't1', partIds: ['p1', 'p-gone'] }],
    })
    expect(collectTwinConfigIssues(config)).toEqual([
      {
        kind: 'dangling-part',
        entityId: 't1',
        path: 'tints[0].partIds[1]',
        detail: '找不到部件 p-gone，这条规则会少染一组节点',
      },
    ])
  })

  it('渐变模式缺区间会被报成永不染色', () => {
    const config = normalizeTwinConfig({
      tints: [{ id: 't1', mode: 'gradient' }],
    })
    expect(collectTwinConfigIssues(config)).toEqual([
      {
        kind: 'gradient-without-range',
        entityId: 't1',
        path: 'tints[0].gradient',
        detail: 'gradient 模式缺合法的 lo/hi 区间，这条规则永远不染色',
      },
    ])
  })

  it('状态模式没有区间不算问题', () => {
    const config = normalizeTwinConfig({ tints: [{ id: 't1' }] })
    expect(collectTwinConfigIssues(config)).toEqual([])
  })
})
