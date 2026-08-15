/**
 * @fileoverview 锁住「归一化不吞、由这里响亮报出」的三类错误：重复 id、悬空引用、
 * 画不出来的元素。三样都不会让渲染报错——一个让实时值被同名实体盖掉，一个让牌
 * 悄悄退回原点，一个让配好的流在画面上根本不出现。
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

  it('信息牌指到不存在的锚点时报出来，并说明它会退回自己的坐标', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }],
      panels: [{ id: 'p1', anchorId: 'gone' }],
    })
    expect(collectTwinConfigIssues(config)).toEqual([
      {
        kind: 'dangling-anchor',
        entityId: 'p1',
        path: 'panels[0].anchorId',
        detail: '找不到锚点 gone，这张牌会退回自己的坐标',
      },
    ])
  })

  it('没填锚点的牌不算悬空——它用的是自己的坐标', () => {
    const config = normalizeTwinConfig({ panels: [{ id: 'p1' }] })
    expect(
      collectTwinConfigIssues(config).filter(
        (issue) => issue.kind === 'dangling-anchor',
      ),
    ).toEqual([])
  })

  it('能量流路径上的悬空点带上具体槽位', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }, { id: 'a2' }],
      flows: [{ id: 'f1', pathAnchors: ['a1', 'gone', 'a2'] }],
    })
    const paths = collectTwinConfigIssues(config).map((issue) => issue.path)
    expect(paths).toEqual(['flows[0].pathAnchors[1]'])
  })

  // ⚠ 一条线至少要两点：不报的话用户看到的是「配了一条流但画面上什么都没有」
  it('可解析点不足两个的流单独报一条', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }],
      flows: [{ id: 'f1', pathAnchors: ['a1'] }],
    })
    expect(
      collectTwinConfigIssues(config).map((issue) => issue.kind),
    ).toEqual(['flow-too-short'])
  })

  it('两个点都在时不报太短', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }, { id: 'a2' }],
      flows: [{ id: 'f1', pathAnchors: ['a1', 'a2'] }],
    })
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
