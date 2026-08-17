/**
 * @fileoverview 契约：模块库按清单声明分组与搜索，能力判定只读 manifest 上的
 * 声明字段——认了具体类型，第三方模块就再也进不了库（DASHBOARD_DESIGN §5.3 陷阱 ③）。
 */
import { describe, expect, it } from 'vitest'
import type { ModuleManifest } from '@dt/contracts'

import {
  acceptsChildren,
  groupModules,
  isPinnedRegion,
} from '@/features/dashboard/moduleLibrary'

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    type: 'demo',
    displayName: '演示',
    category: '演示',
    defaultSize: { width: 100, height: 100 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: {} }),
    ...over,
  }
}

const ALL = [
  manifest({ type: 'b-card', displayName: '柱状卡片', category: '图表' }),
  manifest({ type: 'a-card', displayName: '折线卡片', category: '图表' }),
  manifest({
    type: 'head',
    displayName: '页头',
    category: '布局',
    keywords: ['yetou', 'header'],
  }),
]

describe('分组', () => {
  // ⚠ 期望的是**拼音**序（布 bu < 图 tu、折 zhe < 柱 zhu），不是码位序：
  // 定序器钉死了 zh-CN，换成默认 locale 这条用例会随机器语言红绿翻转
  it('按 category 分组，组与组内都按拼音定序', () => {
    const groups = groupModules(ALL)

    expect(groups.map((group) => group.category)).toEqual(['布局', '图表'])
    expect(groups[1]?.items.map((item) => item.type)).toEqual([
      'a-card',
      'b-card',
    ])
  })

  it('空清单给空分组', () => {
    expect(groupModules([])).toEqual([])
  })
})

describe('搜索', () => {
  it('命中显示名', () => {
    expect(
      groupModules(ALL, '折线').flatMap((group) =>
        group.items.map((item) => item.type),
      ),
    ).toEqual(['a-card'])
  })

  it('命中别名与类型 id，大小写无关', () => {
    expect(
      groupModules(ALL, 'YETOU').flatMap((group) =>
        group.items.map((item) => item.type),
      ),
    ).toEqual(['head'])
    expect(
      groupModules(ALL, 'b-card').flatMap((group) =>
        group.items.map((item) => item.type),
      ),
    ).toEqual(['b-card'])
  })

  it('一个都不命中时给空分组', () => {
    expect(groupModules(ALL, '不存在的东西')).toEqual([])
  })
})

describe('能力判定只读声明', () => {
  it('能接子节点看的是 isContainer', () => {
    expect(acceptsChildren(manifest({ isContainer: true }))).toBe(true)
    expect(acceptsChildren(manifest())).toBe(false)
    expect(acceptsChildren(undefined)).toBe(false)
  })

  it('钉位只判断有没有声明 region，不比具体取值', () => {
    expect(isPinnedRegion(manifest({ region: 'header' }))).toBe(true)
    expect(isPinnedRegion(manifest({ region: 'footer' }))).toBe(true)
    expect(isPinnedRegion(manifest())).toBe(false)
  })
})
