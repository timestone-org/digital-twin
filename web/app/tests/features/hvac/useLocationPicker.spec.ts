/**
 * @fileoverview 「选车间 → 选房间」的两条不变式：选中的房间必须属于当前车间；
 * 铺表单时给的车间与房间要一起活下来。
 *
 * ⚠ 这两条会互相打架：清房间清早了，编辑弹窗一打开就把刚铺进去的房间清掉；
 * 清晚了或不清，换车间后会拿着上一个车间的房间去筛，筛出来是空的而界面看着
 * 一切正常。所以两条一起钉。
 */
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page, Room, Workshop } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import {
  useLocationPicker,
  type LocationPicker,
} from '@/features/hvac/useLocationPicker'

function workshop(id: string, name: string): Workshop {
  return {
    id,
    name,
    room_count: 1,
    ac_unit_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function room(id: string, workshopId: string): Room {
  return {
    id,
    name: `房 ${id}`,
    workshop: { id: workshopId, name: `车间 ${workshopId}` },
    ac_unit_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function onePage<T>(items: T[]): Page<T> {
  return { items, page: 1, size: 200, total: items.length }
}

/** 组合式函数要在组件里才有生命周期，挂一个空壳把它取出来。 */
function mountPicker(placeholder?: string): LocationPicker {
  let picker: LocationPicker | null = null
  const Host = defineComponent({
    setup() {
      picker = useLocationPicker(placeholder)
      return () => null
    },
  })
  mount(Host)
  if (picker === null) throw new Error('picker 未初始化')
  return picker
}

beforeEach(() => {
  vi.spyOn(hvac, 'listWorkshops').mockResolvedValue(
    onePage([workshop('w1', '一车间'), workshop('w2', '二车间')]),
  )
  vi.spyOn(hvac, 'listRooms').mockImplementation((query = {}) =>
    Promise.resolve(
      onePage(
        query.workshop_id === 'w1'
          ? [room('r1', 'w1'), room('r2', 'w1')]
          : [room('r9', 'w2')],
      ),
    ),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useLocationPicker', () => {
  it('选了车间才去拉它的房间', async () => {
    const picker = mountPicker()
    await picker.loadWorkshops()
    expect(picker.workshops.value).toHaveLength(2)
    expect(hvac.listRooms).not.toHaveBeenCalled()

    picker.workshopId.value = 'w1'
    await nextTick()
    await flushPromises()
    expect(picker.rooms.value.map((item) => item.id)).toEqual(['r1', 'r2'])
  })

  it('换车间会作废不属于新车间的房间', async () => {
    const picker = mountPicker()
    picker.select('w1', 'r1')
    await nextTick()
    await flushPromises()
    expect(picker.roomId.value).toBe('r1')

    picker.workshopId.value = 'w2'
    await nextTick()
    await flushPromises()
    expect(picker.roomId.value).toBe('')
  })

  it('铺表单时给的车间与房间一起活下来', async () => {
    // ⚠ 这条钉的是「清房间不能清在房间列表回来之前」：清早了，编辑弹窗打开
    // 时房间就是空的，而车间显示得好好的
    const picker = mountPicker()
    picker.select('w1', 'r2')
    await nextTick()
    await flushPromises()
    expect(picker.workshopId.value).toBe('w1')
    expect(picker.roomId.value).toBe('r2')
  })

  it('把车间清空时房间跟着清空', async () => {
    const picker = mountPicker()
    picker.select('w1', 'r1')
    await nextTick()
    await flushPromises()

    picker.select('')
    await nextTick()
    await flushPromises()
    expect(picker.roomId.value).toBe('')
    expect(picker.rooms.value).toEqual([])
  })

  it('给了占位文案就在两个选择器前各多一项「全部」', async () => {
    const picker = mountPicker('全部')
    await picker.loadWorkshops()
    expect(picker.workshopOptions.value[0]).toEqual({
      value: '',
      label: '全部',
    })
  })

  it('车间取回失败时留一句能给用户看的话', async () => {
    vi.mocked(hvac.listWorkshops).mockRejectedValue(new Error('boom'))
    const picker = mountPicker()
    await picker.loadWorkshops()
    expect(picker.error.value).not.toBeNull()
    expect(picker.workshops.value).toEqual([])
  })

  it('房间取回失败时清空列表并作废已选房间', async () => {
    // 留着一个查不到归属的房间 id，筛出来是空的而界面看着一切正常
    const picker = mountPicker()
    picker.select('w1', 'r1')
    await nextTick()
    await flushPromises()

    vi.mocked(hvac.listRooms).mockRejectedValue(new Error('boom'))
    picker.workshopId.value = 'w2'
    await nextTick()
    await flushPromises()
    expect(picker.rooms.value).toEqual([])
    expect(picker.roomId.value).toBe('')
    expect(picker.error.value).not.toBeNull()
  })

  it('车间数超出单次取回上限时标记出来', async () => {
    vi.mocked(hvac.listWorkshops).mockResolvedValue({
      items: [workshop('w1', '一车间')],
      page: 1,
      size: 200,
      total: 260,
    })
    const picker = mountPicker()
    await picker.loadWorkshops()
    expect(picker.isWorkshopListPartial.value).toBe(true)
  })
})
