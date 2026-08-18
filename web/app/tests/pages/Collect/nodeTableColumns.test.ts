/**
 * @fileoverview 已导入节点表的列配置。
 *
 * ⚠ 这一组守的是「寻址串那一列有多宽」。这张表开着 `fixedLayout`，没写宽度的
 * 列**平分**剩余空间——只留寻址串一列不写，剩余空间才全归它。再多留一列不写
 * 宽度，寻址串当场对半缩水，而界面不会报任何错，只是又变回读不出内容的样子。
 */
import { describe, expect, it } from 'vitest'

import { nodeTableColumns } from '@/pages/Collect/Opcua/scripts/nodeTableColumns'

describe('列配置', () => {
  it('⚠ 只有寻址串一列不写宽度：多一列不写，它就要跟人对半分', () => {
    for (const canManage of [true, false]) {
      const flexible = nodeTableColumns(canManage)
        .filter((column) => column.width === undefined)
        .map((column) => column.key)

      expect(flexible).toEqual(['address'])
    }
  })

  it('选择列只在有改点位权限时出现', () => {
    expect(nodeTableColumns(true).map((one) => one.key)).toContain('select')
    expect(nodeTableColumns(false).map((one) => one.key)).not.toContain(
      'select',
    )
  })

  it('⚠ 固定列宽之和要给寻址串留出余量，否则它会被挤没', () => {
    const fixedRem = nodeTableColumns(true)
      .map((column) => column.width)
      .filter((width): width is string => width !== undefined)
      .reduce((total, width) => total + Number.parseFloat(width), 0)

    // 表格 min-width 是 76rem（NodeTable.vue），差额就是寻址串的保底宽度。
    // 20rem 摆得下约 40 个等宽字符，够看出是哪个点位了
    expect(76 - fixedRem).toBeGreaterThanOrEqual(20)
  })
})
