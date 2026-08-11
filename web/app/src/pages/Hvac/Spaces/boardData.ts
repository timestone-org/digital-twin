/**
 * @fileoverview 空间总览那两份数据的纯整形：按房间归组、说清哪一类没取全。
 * 独立出来是为了能脱离 Vue 单测——它们是这一页里最容易算错的部分。
 */

import type { AcUnit, Page, Room } from '@dt/contracts'

export interface BoardPages {
  rooms: Page<Room>
  units: Page<AcUnit>
}

/**
 * 取不全时说清少了多少，取全了返回 `null`。
 * ⚠ 空间配置页上少画一台空调，人是看不出来的，所以宁可啰嗦也不静默截断。
 * @param pages 房间与空调各自的一页
 */
export function describePartial(pages: BoardPages): string | null {
  const missing: string[] = []
  if (pages.rooms.total > pages.rooms.items.length) {
    missing.push(`房间 ${pages.rooms.items.length}/${pages.rooms.total}`)
  }
  if (pages.units.total > pages.units.items.length) {
    missing.push(`空调 ${pages.units.items.length}/${pages.units.total}`)
  }
  if (missing.length === 0) return null
  return `本车间的数据超出单次取回上限，只画出了 ${missing.join('、')}。`
}

/**
 * 按房间把空调归组。没有空调的房间不会出现在结果里，由调用方兜底成空数组。
 * @param items 当前车间下的全部空调
 */
export function groupByRoom(items: readonly AcUnit[]): Map<string, AcUnit[]> {
  const grouped = new Map<string, AcUnit[]>()
  for (const unit of items) {
    grouped.set(unit.room.id, [...(grouped.get(unit.room.id) ?? []), unit])
  }
  return grouped
}
