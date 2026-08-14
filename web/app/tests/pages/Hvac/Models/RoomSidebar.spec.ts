/**
 * @fileoverview 左栏的两处只能靠用例兜的行为：筛选框何时出现、以及筛掉了
 * 当前选中项时必须说一句——静默少列几个房间，用户只会以为房间没配好。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import type { Room } from '@dt/contracts'

import RoomSidebar from '@/pages/Hvac/Models/components/RoomSidebar.vue'
import { buildRoomListing } from '@/pages/Hvac/Models/roomGroups'
import { STAMP } from '@/testing/modelFixtures'

const WEST = { id: 'w2', name: '西车间' }

function room(
  id: string,
  name: string,
  workshop = { id: 'w1', name: '东车间' },
): Room {
  return {
    id,
    name,
    workshop,
    ac_unit_count: 1,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function mountWith(rooms: Room[], selected: string) {
  const listing = buildRoomListing(rooms, [])
  return mount(RoomSidebar, {
    props: {
      entries: listing.entries,
      hiddenCount: listing.hiddenCount,
      selected,
    },
    attachTo: document.body,
  })
}

/** 九个房间：刚好越过 ROOM_FILTER_MIN。 */
function nineRooms(): Room[] {
  return Array.from({ length: 9 }, (_, at) => room(`r${at}`, `房间${at}`))
}

enableAutoUnmount(afterEach)

describe('筛选框', () => {
  it('房间不多时不渲染搜索框——三五个房间给个搜索框只是噪声', () => {
    const wrapper = mountWith([room('r1', '甲房'), room('r2', '乙房')], 'r1')
    expect(wrapper.find('input[type="search"]').exists()).toBe(false)
  })

  it('超过阈值才出现，输入后实时过滤', async () => {
    const wrapper = mountWith(nineRooms(), 'r0')
    const box = wrapper.find('input[type="search"]')
    expect(box.exists()).toBe(true)
    await box.setValue('房间3')
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.text()).toContain('房间3')
  })

  it('⚠ 过滤掉当前选中的房间时要说一句，别让人以为它没了', async () => {
    const wrapper = mountWith(nineRooms(), 'r0')
    await wrapper.find('input[type="search"]').setValue('房间3')
    expect(wrapper.text()).toContain('当前选中的房间不在筛选结果里')
  })

  it('一个都没匹配上时说清楚', async () => {
    const wrapper = mountWith(nineRooms(), 'r0')
    await wrapper.find('input[type="search"]').setValue('不存在的')
    expect(wrapper.text()).toContain('没有匹配「不存在的」的房间')
  })

  it('按车间名也能筛到', async () => {
    const rooms = [...nineRooms(), room('rw', '西一线', WEST)]
    const wrapper = mountWith(rooms, 'r0')
    await wrapper.find('input[type="search"]').setValue('西车间')
    expect(wrapper.findAll('li')).toHaveLength(1)
  })
})

describe('分组头', () => {
  it('只有一个车间时不渲染分组头，省掉一行噪声', () => {
    const wrapper = mountWith([room('r1', '甲房'), room('r2', '乙房')], 'r1')
    expect(wrapper.find('h3').exists()).toBe(false)
  })

  it('两个车间时各自出头', () => {
    const wrapper = mountWith(
      [room('r1', '甲房'), room('r2', '西一线', WEST)],
      'r1',
    )
    expect(wrapper.findAll('h3').map((node) => node.text())).toEqual([
      '东车间',
      '西车间',
    ])
  })
})

describe('选中与空态', () => {
  it('点一行抛出房间 id；⚠ 再点一次不取消——主从布局必须始终有选中项', async () => {
    const wrapper = mountWith([room('r1', '甲房'), room('r2', '乙房')], 'r1')
    const buttons = wrapper.findAll('li button')
    await buttons[0]?.trigger('click')
    await buttons[1]?.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['r1'], ['r2']])
  })

  it('一个房间都没有时给空态而不是一片空白', () => {
    const wrapper = mountWith([], '')
    expect(wrapper.text()).toContain('还没有配置房间')
  })
})
