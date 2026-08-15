/**
 * @fileoverview 锁住「归一化不吞、由这里响亮报出」的那类错误：重复 id。
 * 它不会让渲染报错，只会让某个实体的实时值安静地被另一个同名实体盖掉。
 */
import { describe, expect, it } from 'vitest'

import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/types'

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
