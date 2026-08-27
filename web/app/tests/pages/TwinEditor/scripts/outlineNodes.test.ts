/**
 * @fileoverview 契约：大纲树的分组顺序、行序号与显隐可用性，删除的连带影响，
 * 以及一条诊断该跳到哪个实体。
 * ⚠ 两条静默的坑由这里钉住：行 key 必须带下标（id 允许重复，只用 id 做 key
 * 会让两行的本地状态串在一起），悬空视点那条诊断只能跳到视点切换段
 * （它的 entityId 是一个**不存在**的视点 id）。
 */
import { collectTwinConfigIssues, normalizeTwinConfig } from '@dt/twin-config'
import type { TwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  TWIN_SCENE_ENTRIES,
  buildTwinOutline,
  twinFlaggedIds,
  twinIssueSelection,
  twinRemoveImpact,
  twinRemoveImpactText,
} from '@/pages/TwinEditor/scripts/outlineNodes'

function makeConfig(over: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    parts: [{ id: 'p1', name: '主机', nodes: ['n1', 'n2'] }],
    anchors: [
      { id: 'a1', name: '进水温度', unit: '℃' },
      { id: 'a2', name: '' },
    ],
    cameras: [{ id: 'c1', name: '全景', isDefault: true }],
    viewpoints: { items: ['c1'] },
    panels: [
      {
        id: 'pl1',
        name: '牌一',
        anchorId: 'a1',
        fields: [{ key: 'f1' }, { key: 'f2' }],
      },
    ],
    arrows: [{ id: 'ar1', name: '流向' }],
    flows: [{ id: 'fl1', name: '蒸汽', pathAnchors: ['a1', 'a2'] }],
    ...over,
  })
}

function sectionOf(config: TwinConfig, key: string) {
  const found = buildTwinOutline(config, new Set()).find(
    (section) => section.key === key,
  )
  if (found === undefined) throw new Error(`缺少分组 ${key}`)
  return found
}

describe('分组', () => {
  it('实体分组按固定顺序摊开，单例都在「场景」区不进分组', () => {
    const keys = buildTwinOutline(makeConfig(), new Set()).map((s) => s.key)

    expect(keys).toEqual([
      'parts',
      'anchors',
      'cameras',
      'panels',
      'arrows',
      'flows',
    ])
  })

  it('「场景」区三行各带自己的选中值', () => {
    expect(TWIN_SCENE_ENTRIES.map((entry) => entry.selection)).toEqual([
      { kind: 'model' },
      { kind: 'viewpoints' },
      { kind: 'roam' },
    ])
  })

  it('实体段带集合名与中文标题', () => {
    const anchors = sectionOf(makeConfig(), 'anchors')

    expect(anchors.kind).toBe('anchors')
    expect(anchors.title).toBe('锚点')
  })
})

describe('行', () => {
  it('序号从 1 起，就是文档序', () => {
    const rows = sectionOf(makeConfig(), 'anchors').rows

    expect(rows.map((row) => row.index)).toEqual([1, 2])
    expect(rows.map((row) => row.id)).toEqual(['a1', 'a2'])
  })

  it('名字空着的行退回显示 id', () => {
    const rows = sectionOf(makeConfig(), 'anchors').rows

    expect(rows[0]?.label).toBe('进水温度')
    expect(rows[1]?.label).toBe('a2')
  })

  it('视点没有显隐字段，它的行不给显隐值', () => {
    expect(sectionOf(makeConfig(), 'cameras').rows[0]?.visible).toBeNull()
  })

  it('其余五类都带显隐值', () => {
    const kinds = ['parts', 'anchors', 'panels', 'arrows', 'flows']
    const config = makeConfig()

    for (const kind of kinds) {
      expect(sectionOf(config, kind).rows[0]?.visible).toBe(true)
    }
  })

  it('隐藏了的实体，行上的显隐值跟着变', () => {
    const config = makeConfig({
      parts: [{ id: 'p1', name: '主机', visibility: { visible: false } }],
    })

    expect(sectionOf(config, 'parts').rows[0]?.visible).toBe(false)
  })

  it('头一行不能上移、末一行不能下移', () => {
    const rows = sectionOf(makeConfig(), 'anchors').rows

    expect(rows[0]?.canMoveUp).toBe(false)
    expect(rows[0]?.canMoveDown).toBe(true)
    expect(rows[1]?.canMoveUp).toBe(true)
    expect(rows[1]?.canMoveDown).toBe(false)
  })

  it('只剩一行时上下都动不了', () => {
    expect(sectionOf(makeConfig(), 'parts').rows[0]?.canMoveDown).toBe(false)
  })

  it('id 重复时两行的 key 仍然互不相同', () => {
    const config = makeConfig({
      anchors: [
        { id: 'same', name: '甲' },
        { id: 'same', name: '乙' },
      ],
    })
    const rows = sectionOf(config, 'anchors').rows

    expect(rows[0]?.key).not.toBe(rows[1]?.key)
  })

  it('诊断点到的实体，行上打红点', () => {
    const rows = buildTwinOutline(makeConfig(), new Set(['a2'])).find(
      (section) => section.key === 'anchors',
    )?.rows

    expect(rows?.[0]?.flagged).toBe(false)
    expect(rows?.[1]?.flagged).toBe(true)
  })

  it('名字后面的补充信息各类各算各的', () => {
    const config = makeConfig()

    expect(sectionOf(config, 'parts').rows[0]?.meta).toBe('2 节点')
    expect(sectionOf(config, 'panels').rows[0]?.meta).toBe('2 字段')
    expect(sectionOf(config, 'flows').rows[0]?.meta).toBe('2 锚点')
    expect(sectionOf(config, 'cameras').rows[0]?.meta).toBe('默认')
    expect(sectionOf(config, 'anchors').rows[0]?.meta).toBe('℃')
  })

  it('非默认视点的 meta 是空串，不写「默认」', () => {
    const config = makeConfig({ cameras: [{ id: 'c1', name: '侧视' }] })

    expect(sectionOf(config, 'cameras').rows[0]?.meta).toBe('')
  })
})

describe('夹视图', () => {
  const FOLDERED = {
    anchors: [
      { id: 'a1', name: '进水温度' },
      { id: 'a2', name: '回水温度' },
      { id: 'a3', name: '流量' },
    ],
    folders: [
      { id: 'f2', kind: 'anchors', name: '后段', itemIds: ['a3'] },
      { id: 'f1', kind: 'anchors', name: '', itemIds: ['a1'] },
      { id: 'fp', kind: 'parts', name: '整机', itemIds: ['p1'] },
    ],
  }

  it('夹按夹表序排，只列自己段的夹', () => {
    const anchors = sectionOf(makeConfig(FOLDERED), 'anchors')

    expect(anchors.folders.map((folder) => folder.id)).toEqual(['f2', 'f1'])
  })

  it('夹的折叠键带 folder: 前缀，名字空着退回夹 id', () => {
    const anchors = sectionOf(makeConfig(FOLDERED), 'anchors')

    expect(anchors.folders[0]?.key).toBe('folder:f2')
    expect(anchors.folders[0]?.label).toBe('后段')
    expect(anchors.folders[1]?.label).toBe('f1')
  })

  it('成员进了夹就不再是散行，散行按文档序排在后', () => {
    const anchors = sectionOf(makeConfig(FOLDERED), 'anchors')

    expect(anchors.rows.map((row) => row.id)).toEqual(['a2'])
  })

  // 序号是数组绑定的对齐位次，进出夹都不改它
  it('夹内行的序号仍是文档序，不按夹内位置重排', () => {
    const anchors = sectionOf(makeConfig(FOLDERED), 'anchors')

    expect(anchors.folders[0]?.rows.map((row) => row.index)).toEqual([3])
    expect(anchors.folders[1]?.rows.map((row) => row.index)).toEqual([1])
    expect(anchors.rows.map((row) => row.index)).toEqual([2])
  })

  it('夹内成员多于一个时按文档序排，不按成员表序', () => {
    const config = makeConfig({
      anchors: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      folders: [{ id: 'f1', kind: 'anchors', itemIds: ['a3', 'a1'] }],
    })
    const anchors = sectionOf(config, 'anchors')

    expect(anchors.folders[0]?.rows.map((row) => row.id)).toEqual(['a1', 'a3'])
  })

  it('段计数是夹内加散行的总数', () => {
    expect(sectionOf(makeConfig(FOLDERED), 'anchors').count).toBe(3)
  })

  it('空夹留在夹表里，成员是空表', () => {
    const config = makeConfig({
      folders: [{ id: 'f-empty', kind: 'anchors', itemIds: [] }],
    })

    expect(sectionOf(config, 'anchors').folders[0]?.rows).toEqual([])
  })

  // id 允许重复（由诊断报出），两行进同一个夹、文档序不乱
  it('重复 id 的两行进成员表指到的同一个夹', () => {
    const config = makeConfig({
      anchors: [
        { id: 'same', name: '甲' },
        { id: 'same', name: '乙' },
      ],
      folders: [{ id: 'f1', kind: 'anchors', itemIds: ['same'] }],
    })
    const anchors = sectionOf(config, 'anchors')

    expect(anchors.folders[0]?.rows.map((row) => row.label)).toEqual([
      '甲',
      '乙',
    ])
    expect(anchors.rows).toEqual([])
  })
})

describe('删除的连带影响', () => {
  it('删锚点数出引用它的信息牌与能量流', () => {
    expect(twinRemoveImpact(makeConfig(), 'anchors', 'a1')).toMatchObject({
      panels: 1,
      flows: 1,
      viewpoints: 0,
    })
  })

  it('删视点数出视点切换里引用它的项', () => {
    expect(twinRemoveImpact(makeConfig(), 'cameras', 'c1')).toMatchObject({
      panels: 0,
      flows: 0,
      viewpoints: 1,
    })
  })

  it('删部件不牵连别人', () => {
    expect(twinRemoveImpact(makeConfig(), 'parts', 'p1')).toEqual({
      panels: 0,
      flows: 0,
      viewpoints: 0,
      parts: 0,
    })
  })

  it('删视点数出远距取景指着它的部件', () => {
    const config = makeConfig({
      parts: [{ id: 'p1', click: { far: 'view', cameraId: 'c9' } }],
      cameras: [{ id: 'c9' }],
    })

    expect(twinRemoveImpact(config, 'cameras', 'c9')).toMatchObject({
      parts: 1,
    })
  })

  it('删视点的确认文案点名那几个部件', () => {
    const config = makeConfig({
      parts: [{ id: 'p1', click: { far: 'view', cameraId: 'c9' } }],
      cameras: [{ id: 'c9' }],
    })
    const text = twinRemoveImpactText(config, 'cameras', 'c9')

    expect(text).toContain('1 个部件的远距取景')
  })

  it('没人引用的锚点删了也不牵连别人', () => {
    expect(twinRemoveImpactText(makeConfig(), 'anchors', 'a9')).toBe('')
  })

  it('确认文案点名会悬空的张数与条数', () => {
    const text = twinRemoveImpactText(makeConfig(), 'anchors', 'a1')

    expect(text).toContain('1 张信息牌')
    expect(text).toContain('1 条能量流')
  })

  it('删视点的确认文案点名视点切换里的项数', () => {
    expect(twinRemoveImpactText(makeConfig(), 'cameras', 'c1')).toContain(
      '视点切换里的 1 项',
    )
  })
})

describe('诊断到实体的映射', () => {
  const broken = makeConfig({
    anchors: [
      { id: 'a1', name: '甲' },
      { id: 'a1', name: '乙' },
    ],
    viewpoints: { items: ['ghost'] },
    panels: [{ id: 'pl1', anchorId: 'missing', fields: [{ key: 'f1' }] }],
    flows: [{ id: 'fl1', pathAnchors: ['a1'] }],
  })
  const issues = collectTwinConfigIssues(broken)

  function issueOf(kind: string) {
    const found = issues.find((issue) => issue.kind === kind)
    if (found === undefined) throw new Error(`缺少 ${kind} 这条诊断`)
    return found
  }

  it('四类问题都被收出来了', () => {
    expect(issues.map((issue) => issue.kind).sort()).toEqual([
      'dangling-anchor',
      'dangling-camera',
      'duplicate-id',
      'flow-too-short',
    ])
  })

  it('重复 id 跳到那一类的实体', () => {
    expect(twinIssueSelection(issueOf('duplicate-id'))).toEqual({
      kind: 'anchors',
      id: 'a1',
    })
  })

  it('悬空视点跳到视点切换段，不跳那个不存在的视点', () => {
    expect(twinIssueSelection(issueOf('dangling-camera'))).toEqual({
      kind: 'viewpoints',
    })
  })

  it('悬空锚点跳到指过去的那张牌', () => {
    expect(twinIssueSelection(issueOf('dangling-anchor'))).toEqual({
      kind: 'panels',
      id: 'pl1',
    })
  })

  it('画不出的流跳到那条流', () => {
    expect(twinIssueSelection(issueOf('flow-too-short'))).toEqual({
      kind: 'flows',
      id: 'fl1',
    })
  })

  it('落不到实体上的路径不给跳', () => {
    expect(
      twinIssueSelection({
        kind: 'duplicate-id',
        entityId: 'x',
        path: 'model.asset',
        detail: '',
      }),
    ).toBeNull()
  })

  it('漫游的问题跳到漫游段', () => {
    expect(
      twinIssueSelection({
        kind: 'roam-too-short',
        entityId: '',
        path: 'roamTour.items',
        detail: '',
      }),
    ).toEqual({ kind: 'roam' })
  })

  it('不以字母开头的路径不给跳', () => {
    expect(
      twinIssueSelection({
        kind: 'duplicate-id',
        entityId: 'x',
        path: '0.bad',
        detail: '',
      }),
    ).toBeNull()
  })

  it('红点集合收的是诊断点到的实体 id', () => {
    expect(twinFlaggedIds(issues)).toContain('pl1')
  })
})
