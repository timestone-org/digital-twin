/**
 * @fileoverview 契约：样式分栏的显示名只有一份，调色板与节点检查器读同一张表。
 *
 * ⚠ 两边各写一份的话，同一批没分栏的样式在调色板里叫「未分类」、在样式下拉里叫
 * 「其他」，加一个内置分类还得记着改两处。
 */
import { describe, expect, it } from 'vitest'

import { twin2dCategoryLabel } from '@/pages/Twin2dEditor/scripts/styleCategories'

describe('分栏显示名', () => {
  it('预置库的分栏给中文名', () => {
    expect(twin2dCategoryLabel('source')).toBe('热源')
  })

  it('没登记的分栏原样显示', () => {
    expect(twin2dCategoryLabel('我的分栏')).toBe('我的分栏')
  })

  it('没分栏的归「未分类」', () => {
    expect(twin2dCategoryLabel('')).toBe('未分类')
  })

  // ⚠ 大纲里「标注」一段指的是辅助框 / 线 / 文字，文字标注这份节点样式再叫「标注」就撞名
  it('文字标注那一栏不与大纲的「标注」段同名', () => {
    expect(twin2dCategoryLabel('label')).not.toBe('标注')
  })
})
