/**
 * @fileoverview 锁住大纲搜索的匹配口径：不分大小写包含（行名/行 id/段标题/夹名）、
 * 三段切片拼回原文、段标题命中整段放行、夹名命中整夹放行、空词直通。
 * 展开态由组件层「只算不写」，这里只保证过滤视图不碰折叠集。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  filterTwinOutline,
  matchSlices,
} from '@/pages/TwinEditor/scripts/outlineFilter'
import {
  TWIN_SCENE_ENTRIES,
  buildTwinOutline,
} from '@/pages/TwinEditor/scripts/outlineNodes'
import type { TwinOutlineSection } from '@/pages/TwinEditor/scripts/outlineNodes'

function sections(): TwinOutlineSection[] {
  return buildTwinOutline(
    normalizeTwinConfig({
      parts: [{ id: 'p1', name: '主机' }],
      anchors: [
        { id: 'a1', name: '进水温度' },
        { id: 'a2', name: '回水温度' },
        { id: 'AX-9', name: '流量' },
      ],
      folders: [
        { id: 'f1', kind: 'anchors', name: '温度组', itemIds: ['a1', 'a2'] },
        { id: 'f2', kind: 'anchors', name: '备用组', itemIds: [] },
      ],
    }),
    new Set(),
  )
}

function filtered(query: string) {
  return filterTwinOutline(sections(), TWIN_SCENE_ENTRIES, query)
}

function sectionOf(view: ReturnType<typeof filtered>, key: string) {
  const found = view.sections.find((item) => item.section.key === key)
  if (found === undefined) throw new Error(`过滤后没有 ${key} 这一段`)
  return found
}

describe('matchSlices', () => {
  it('空词不算命中', () => {
    expect(matchSlices('进水温度', '')).toBeNull()
  })

  it('没命中返回 null', () => {
    expect(matchSlices('进水温度', '压力')).toBeNull()
  })

  it('命中给三段切片，拼回去就是原文', () => {
    const slices = matchSlices('进水温度', '水温')

    expect(slices).toEqual({ before: '进', match: '水温', after: '度' })
  })

  it('不分大小写，切片保留原文的大小写', () => {
    expect(matchSlices('TempOut', 'tempo')).toEqual({
      before: '',
      match: 'TempO',
      after: 'ut',
    })
  })

  it('命中在开头与结尾时空段是空串', () => {
    expect(matchSlices('温度', '温度')).toEqual({
      before: '',
      match: '温度',
      after: '',
    })
  })
})

describe('空词直通', () => {
  it('active 为 false，段、夹、散行与场景区全都在', () => {
    const view = filtered('')

    expect(view.active).toBe(false)
    expect(view.scene).toHaveLength(3)
    expect(view.sections).toHaveLength(7)
    expect(sectionOf(view, 'anchors').folders).toHaveLength(2)
    expect(sectionOf(view, 'anchors').rows).toHaveLength(1)
  })

  it('全空白的词等于空词', () => {
    expect(filtered('   ').active).toBe(false)
  })

  it('直通态没有任何高亮切片', () => {
    const anchors = sectionOf(filtered(''), 'anchors')

    expect(anchors.slices).toBeNull()
    expect(anchors.folders.every((folder) => folder.slices === null)).toBe(true)
  })

  it('直通态的 hitCount 是段内总数', () => {
    expect(sectionOf(filtered(''), 'anchors').hitCount).toBe(3)
  })
})

describe('按行匹配', () => {
  it('词先 trim 再匹配', () => {
    const view = filtered('  回水  ')

    expect(view.active).toBe(true)
    const anchors = sectionOf(view, 'anchors')
    expect(anchors.folders).toHaveLength(1)
    expect(anchors.folders[0]?.rows.map((item) => item.row.id)).toEqual(['a2'])
  })

  it('行名命中带切片，夹里只剩命中的行', () => {
    const anchors = sectionOf(filtered('回水'), 'anchors')

    expect(anchors.folders[0]?.rows[0]?.slices).toEqual({
      before: '',
      match: '回水',
      after: '温度',
    })
    expect(anchors.hitCount).toBe(1)
  })

  it('按行 id 命中时行放行但名字不高亮', () => {
    const anchors = sectionOf(filtered('ax-9'), 'anchors')

    expect(anchors.rows.map((item) => item.row.id)).toEqual(['AX-9'])
    expect(anchors.rows[0]?.slices).toBeNull()
  })

  it('没命中的段整个隐藏', () => {
    const view = filtered('主机')

    expect(view.sections.map((item) => item.section.key)).toEqual(['parts'])
  })

  it('谁都不命中时段与场景都空', () => {
    const view = filtered('压缩机')

    expect(view.sections).toEqual([])
    expect(view.scene).toEqual([])
  })
})

describe('整段与整夹放行', () => {
  it('段标题命中显示整段：夹、散行一个不少', () => {
    const anchors = sectionOf(filtered('锚点'), 'anchors')

    expect(anchors.slices).not.toBeNull()
    expect(anchors.folders).toHaveLength(2)
    expect(anchors.rows).toHaveLength(1)
    expect(anchors.hitCount).toBe(3)
  })

  it('夹名命中显示整夹，夹名带切片', () => {
    const anchors = sectionOf(filtered('温度组'), 'anchors')

    expect(anchors.folders).toHaveLength(1)
    expect(anchors.folders[0]?.slices).toEqual({
      before: '',
      match: '温度组',
      after: '',
    })
    expect(anchors.folders[0]?.rows.map((item) => item.row.id)).toEqual([
      'a1',
      'a2',
    ])
  })

  it('夹名没命中且夹内无命中时整夹隐藏', () => {
    const anchors = sectionOf(filtered('回水'), 'anchors')

    expect(anchors.folders.map((item) => item.folder.id)).toEqual(['f1'])
  })
})

describe('场景区', () => {
  it('场景行按标题命中，命中的带切片', () => {
    const view = filtered('漫游')

    expect(view.scene.map((item) => item.entry.key)).toEqual(['roam'])
    expect(view.scene[0]?.slices).toEqual({
      before: '自动',
      match: '漫游',
      after: '',
    })
  })
})
