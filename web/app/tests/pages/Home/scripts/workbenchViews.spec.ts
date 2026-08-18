/**
 * @fileoverview 契约：弹窗要的三份派生视图——按项目分组、可覆盖目标，
 * 以及「项目内已有同名屏」的判定（只提示不拦，故空名字一律判不重名）。
 */
import { describe, expect, it } from 'vitest'

import type { DashboardSummary } from '@/api/dashboardWire'
import {
  groupByProject,
  hasNameClash,
  toImportTargets,
} from '@/pages/Home/scripts/workbenchViews'

function dashboard(
  id: string,
  projectId: string,
  name: string,
): DashboardSummary {
  return {
    id,
    projectId,
    name,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

const ITEMS = [
  dashboard('d1', 'p1', '总览'),
  dashboard('d2', 'p1', '能耗'),
  dashboard('d3', 'p2', '产线'),
]

describe('按项目分组', () => {
  it('同一个项目的屏收在一条上，顺序不变', () => {
    const grouped = groupByProject(ITEMS)

    expect(grouped.p1?.map((item) => item.id)).toEqual(['d1', 'd2'])
    expect(grouped.p2?.map((item) => item.id)).toEqual(['d3'])
  })

  it('一张屏都没有时给空对象而不是抛错', () => {
    expect(groupByProject([])).toEqual({})
  })
})

describe('可覆盖目标', () => {
  it('只留 id 与名字，不把整条 summary 传进弹窗', () => {
    expect(toImportTargets(ITEMS)).toEqual([
      { id: 'd1', name: '总览' },
      { id: 'd2', name: '能耗' },
      { id: 'd3', name: '产线' },
    ])
  })
})

describe('重名判定', () => {
  it('名字一样就算重名，前后空白不算差异', () => {
    expect(hasNameClash(ITEMS, '  总览 ')).toBe(true)
  })

  it('没有同名的给 false', () => {
    expect(hasNameClash(ITEMS, '新屏')).toBe(false)
  })

  it('没有名字或名字全是空白时一律判不重名', () => {
    expect(hasNameClash(ITEMS, undefined)).toBe(false)
    expect(hasNameClash(ITEMS, '   ')).toBe(false)
  })
})
