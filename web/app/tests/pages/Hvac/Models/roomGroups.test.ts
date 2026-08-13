/**
 * @fileoverview 左栏房间列表的纯逻辑：收哪些、怎么排、选中兜底。
 */
import { describe, expect, it } from 'vitest'
import type { Room } from '@dt/contracts'

import {
  buildRoomListing,
  filterRooms,
  groupByWorkshop,
  resolveRoomId,
} from '@/pages/Hvac/Models/roomGroups'
import { STAMP, model } from '@/testing/modelFixtures'

function room(
  id: string,
  name: string,
  units: number,
  workshop = { id: 'w1', name: '东车间' },
): Room {
  return {
    id,
    name,
    workshop,
    ac_unit_count: units,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

const WEST = { id: 'w2', name: '西车间' }

describe('收哪些房间', () => {
  it('⚠ 没有空调但有历史模型的房间照样进栏，否则那些模型无从查看与删除', () => {
    const listing = buildRoomListing(
      [room('r1', '注塑房', 0), room('r2', '喷涂房', 0)],
      [model({ id: 'm1', room: { id: 'r1', name: '注塑房' } })],
    )
    expect(listing.entries.map((entry) => entry.id)).toEqual(['r1'])
    expect(listing.hiddenCount).toBe(1)
  })

  it('模型数与训练中圆点从全量模型客户端数出来', () => {
    const listing = buildRoomListing(
      [room('r1', '注塑房', 2)],
      [
        model({ id: 'm1' }),
        model({ id: 'm2', status: 'training' }),
        model({ id: 'm3', room: { id: 'r9', name: '别的' } }),
      ],
    )
    expect(listing.entries[0]?.modelCount).toBe(2)
    expect(listing.entries[0]?.isTraining).toBe(true)
  })

  it('⚠ 按车间名再按房间名排，不按模型数——数量一变位置就跳', () => {
    const listing = buildRoomListing(
      [
        room('r1', '乙房', 1),
        room('r2', '甲房', 1, WEST),
        room('r3', '甲房', 1),
      ],
      [model({ id: 'm1', room: { id: 'r1', name: '乙房' } })],
    )
    expect(listing.entries.map((entry) => entry.id)).toEqual(['r3', 'r1', 'r2'])
  })
})

describe('分组与过滤', () => {
  const entries = buildRoomListing(
    [room('r1', '甲房', 1), room('r2', '乙房', 1, WEST)],
    [],
  ).entries

  it('按车间切成组，组内保持入参序', () => {
    const groups = groupByWorkshop(entries)
    expect(groups.map((group) => group.name)).toEqual(['东车间', '西车间'])
    expect(groups[0]?.rooms).toHaveLength(1)
  })

  it('关键词匹配房间名或车间名，大小写无关', () => {
    expect(filterRooms(entries, '西').map((entry) => entry.id)).toEqual(['r2'])
    expect(filterRooms(entries, '甲').map((entry) => entry.id)).toEqual(['r1'])
    expect(filterRooms(entries, '')).toHaveLength(2)
    expect(filterRooms(entries, '不存在')).toHaveLength(0)
  })
})

describe('选中兜底', () => {
  const entries = buildRoomListing(
    [room('r1', '甲房', 1), room('r2', '乙房', 1)],
    [model({ id: 'm1', room: { id: 'r2', name: '乙房' } })],
  ).entries

  it('地址栏给的房间存在就用它', () => {
    expect(resolveRoomId(entries, 'r1')).toBe('r1')
  })

  it('⚠ 查不到时先挑有模型的那个，而不是第一个', () => {
    expect(resolveRoomId(entries, 'nope')).toBe('r2')
    expect(resolveRoomId(entries, '')).toBe('r2')
  })

  it('都没模型时挑第一个；一个房间都没有时给空串', () => {
    const bare = buildRoomListing([room('r1', '甲房', 1)], []).entries
    expect(resolveRoomId(bare, '')).toBe('r1')
    expect(resolveRoomId([], '')).toBe('')
  })
})
