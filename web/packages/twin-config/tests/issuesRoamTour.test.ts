/**
 * @fileoverview 锁住漫游轨迹的两类诊断：轨迹引用了不存在的视点、开着漫游却凑不
 * 够两站。
 *
 * ⚠ 两样都不会让渲染报错：前者是「这一站被安静地跳过」，后者是「开关明明开着，
 * 镜头却一动不动」。归一化不清理引用，只有这里报得出来。
 */
import { describe, expect, it } from 'vitest'

import { collectTwinConfigIssues } from '../src/issues'
import { normalizeTwinConfig } from '../src/normalize'

const TWO_CAMERAS = [{ id: 'c1' }, { id: 'c2' }]

describe('轨迹上的悬空视点', () => {
  it('指到不存在的视点时带上具体槽位报出来', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      roamTour: { enabled: true, items: ['c1', '没了', 'c2'] },
    })
    const issues = collectTwinConfigIssues(config)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      kind: 'dangling-camera',
      entityId: '没了',
      path: 'roamTour.items[1]',
    })
  })

  it('轨迹与视点切换各报各的，路径分得开', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      viewpoints: { items: ['丢了'] },
      roamTour: { enabled: true, items: ['c1', 'c2', '没了'] },
    })
    expect(collectTwinConfigIssues(config).map((issue) => issue.path)).toEqual([
      'viewpoints.items[0]',
      'roamTour.items[2]',
    ])
  })

  it('轨迹没开也照样报悬空——配置本身就是错的', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      roamTour: { enabled: false, items: ['c1', '没了'] },
    })
    expect(collectTwinConfigIssues(config).map((issue) => issue.kind)).toEqual([
      'dangling-camera',
    ])
  })
})

describe('凑不够两站的轨迹', () => {
  // ⚠ 一段都摊不出来时运行态整条不播，而开关还开着
  it('开了漫游却只有一站时单独报一条', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      roamTour: { enabled: true, items: ['c1'] },
    })
    const issues = collectTwinConfigIssues(config)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      kind: 'roam-too-short',
      path: 'roamTour.items',
    })
  })

  it('两站里有一站悬空时，悬空与太短两条都报', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      roamTour: { enabled: true, items: ['c1', '没了'] },
    })
    expect(collectTwinConfigIssues(config).map((issue) => issue.kind)).toEqual([
      'dangling-camera',
      'roam-too-short',
    ])
  })

  it('没开漫游时不报太短——空轨迹是正常的未配置态', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      roamTour: { enabled: false, items: [] },
    })
    expect(collectTwinConfigIssues(config)).toEqual([])
  })

  it('两站都在时一条都不报', () => {
    const config = normalizeTwinConfig({
      cameras: TWO_CAMERAS,
      roamTour: { enabled: true, items: ['c1', 'c2'] },
    })
    expect(collectTwinConfigIssues(config)).toEqual([])
  })
})
