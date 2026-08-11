/**
 * @fileoverview 空间总览两份数据的整形口径：按房间归组、取不全要说出来。
 * ⚠ 归组算错的表现是「某台空调画进了别的房间」，而两个房间都画得出来、
 * 台数也都对得上，肉眼根本对不出来——所以这两条必须逐项断言。
 */
import { describe, expect, it } from 'vitest'
import type { AcUnit, Page, Room } from '@dt/contracts'

import { describePartial, groupByRoom } from '@/pages/Hvac/Spaces/boardData'

function unit(id: string, roomId: string): AcUnit {
  return {
    id,
    serial: `AC-${id}`,
    name: `机 ${id}`,
    room: { id: roomId, name: `房 ${roomId}` },
    workshop: { id: 'w1', name: '一车间' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function page<T>(items: T[], total: number): Page<T> {
  return { items, page: 1, size: items.length, total }
}

describe('groupByRoom', () => {
  it('同一房间的空调归进同一组', () => {
    const grouped = groupByRoom([
      unit('a', 'r1'),
      unit('b', 'r2'),
      unit('c', 'r1'),
    ])
    expect(grouped.get('r1')?.map((item) => item.id)).toEqual(['a', 'c'])
    expect(grouped.get('r2')?.map((item) => item.id)).toEqual(['b'])
  })

  it('保持传入的先后次序', () => {
    const grouped = groupByRoom([unit('z', 'r1'), unit('a', 'r1')])
    expect(grouped.get('r1')?.map((item) => item.id)).toEqual(['z', 'a'])
  })

  it('没有空调的房间不出现在结果里，由调用方兜底成空数组', () => {
    expect(groupByRoom([]).size).toBe(0)
  })
})

describe('describePartial', () => {
  it('两类都取全时不出提示', () => {
    const pages = {
      rooms: page<Room>([], 0),
      units: page<AcUnit>([unit('a', 'r1')], 1),
    }
    expect(describePartial(pages)).toBeNull()
  })

  it('空调没取全时说清取到了多少', () => {
    const pages = {
      rooms: page<Room>([], 0),
      units: page<AcUnit>([unit('a', 'r1')], 240),
    }
    expect(describePartial(pages)).toContain('空调 1/240')
  })

  it('两类都没取全时一并列出', () => {
    const pages = {
      rooms: page<Room>([], 300),
      units: page<AcUnit>([], 400),
    }
    const hint = describePartial(pages)
    expect(hint).toContain('房间 0/300')
    expect(hint).toContain('空调 0/400')
  })
})
