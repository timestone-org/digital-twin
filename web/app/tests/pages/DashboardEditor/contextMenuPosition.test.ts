/**
 * @fileoverview 右键菜单落点：四个方向都锁边，小视口里不顶出左上角。
 */
import { describe, expect, it } from 'vitest'

import {
  CTX_MENU_HEIGHT,
  CTX_MENU_WIDTH,
  clampContextMenu,
} from '@/pages/DashboardEditor/contextMenuPosition'

describe('钳位', () => {
  it('远离边缘时原样返回', () => {
    expect(clampContextMenu(100, 120, 1920, 1080)).toEqual({ x: 100, y: 120 })
  })

  it('靠右下时往回收', () => {
    const at = clampContextMenu(1900, 1060, 1920, 1080)
    expect(at.x).toBe(1920 - CTX_MENU_WIDTH - 8)
    expect(at.y).toBe(1080 - CTX_MENU_HEIGHT - 8)
  })

  it('视口比菜单还小的时候锁到左上留白，而不是负坐标', () => {
    expect(clampContextMenu(50, 50, 200, 200)).toEqual({ x: 8, y: 8 })
  })
})
