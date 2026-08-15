/**
 * @fileoverview 锁住「归一化不吞、由这里响亮报出」的两类错误：重复 id 与悬空引用。
 * 两样都不会让渲染报错——一个让实时值被同名实体盖掉，一个让切换条上少几个按钮。
 */
import { describe, expect, it } from 'vitest'

import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/normalize'

describe('collectTwinConfigIssues', () => {
  it('干净的配置没有问题', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'p1', nodes: ['a'] }],
      anchors: [{ id: 'a1' }],
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

  it('视点切换条列到一个不存在的视点时报出来', () => {
    const config = normalizeTwinConfig({
      cameras: [{ id: 'c1' }],
      viewpoints: { items: ['c1', 'c-gone'] },
    })
    expect(collectTwinConfigIssues(config)).toEqual([
      {
        kind: 'dangling-camera',
        entityId: 'c-gone',
        path: 'viewpoints.items[1]',
        detail: '找不到视点 c-gone，切换条上会少这一个',
      },
    ])
  })

  it('切换条为空表示按文档序全显示，不是悬空', () => {
    const config = normalizeTwinConfig({ cameras: [{ id: 'c1' }] })
    expect(collectTwinConfigIssues(config)).toEqual([])
  })

  it('锚点的重复 id 同样报出，且排在部件之后', () => {
    const config = normalizeTwinConfig({
      parts: [{ id: 'p1' }, { id: 'p1' }],
      anchors: [{ id: 'a1' }, { id: 'a1' }],
    })
    expect(collectTwinConfigIssues(config).map((issue) => issue.path)).toEqual([
      'parts[1].id',
      'anchors[1].id',
    ])
  })
})
