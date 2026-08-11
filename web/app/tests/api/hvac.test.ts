/**
 * @fileoverview 锁住空调与空间接口的 URL 形状、方法、载荷，以及**每一条都带
 * platform 前缀**。
 *
 * ⚠ 漏给 `baseUrl` 不会有任何编译期报错：请求会打到 `/api/v1/auth/...`，
 * 边缘按前缀反代，拿回来的是一个 404 信封——现象是「这个页面没数据」，
 * 与真实原因隔得极远。所以每条用例都要断言前缀。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as hvac from '@/api/hvac'
import { PLATFORM_BASE_URL } from '@/config/app'

// ⚠ 两个入口都要打桩：取数走 requestData（必须有 data），
// 删除这类 204 的走 request。只桩一个的话另一个会真的去发 fetch。
let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, size: 20, total: 0 })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('每一条都打 platform 前缀', () => {
  it.each([
    ['listWorkshops', () => hvac.listWorkshops()],
    ['createWorkshop', () => hvac.createWorkshop('东车间')],
    ['updateWorkshop', () => hvac.updateWorkshop('w1', '西车间')],
    ['deleteWorkshop', () => hvac.deleteWorkshop('w1')],
    ['listRooms', () => hvac.listRooms()],
    ['createRoom', () => hvac.createRoom({ workshop_id: 'w1', name: '房' })],
    ['updateRoom', () => hvac.updateRoom('r1', { name: '房' })],
    ['deleteRoom', () => hvac.deleteRoom('r1')],
    ['listAcUnits', () => hvac.listAcUnits()],
    [
      'createAcUnit',
      () => hvac.createAcUnit({ serial: 'A', name: '机', room_id: 'r1' }),
    ],
    ['updateAcUnit', () => hvac.updateAcUnit('a1', { name: '机' })],
    ['deleteAcUnit', () => hvac.deleteAcUnit('a1')],
    ['relocateAcUnits', () => hvac.relocateAcUnits(['a1'], 'r1')],
  ])('%s', async (_name, invoke) => {
    await invoke()
    expect(call()[1].baseUrl).toBe(PLATFORM_BASE_URL)
  })
})

describe('车间接口', () => {
  it('列表带分页与关键字', async () => {
    await hvac.listWorkshops({ q: '东', size: 200 })
    const [path, options] = call()
    expect(path).toBe('/workshops')
    expect(options.query).toEqual({ q: '东', size: 200 })
  })

  it('建车间用 POST，只送名字', async () => {
    await hvac.createWorkshop('东车间')
    const [path, options] = call()
    expect(path).toBe('/workshops')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ name: '东车间' })
  })

  it('改名用 PATCH', async () => {
    await hvac.updateWorkshop('w1', '西车间')
    const [path, options] = call()
    expect(path).toBe('/workshops/w1')
    expect(options.method).toBe('PATCH')
  })

  it('删除用 DELETE', async () => {
    await hvac.deleteWorkshop('w1')
    expect(call()[1].method).toBe('DELETE')
  })
})

describe('房间接口', () => {
  it('列表能按车间过滤', async () => {
    await hvac.listRooms({ workshop_id: 'w1', size: 200 })
    const [path, options] = call()
    expect(path).toBe('/rooms')
    expect(options.query).toEqual({ workshop_id: 'w1', size: 200 })
  })

  it('建房间要带车间', async () => {
    await hvac.createRoom({ workshop_id: 'w1', name: '注塑房' })
    const [path, options] = call()
    expect(path).toBe('/rooms')
    expect(options.body).toEqual({ workshop_id: 'w1', name: '注塑房' })
  })

  it('整间房换车间也走 PATCH', async () => {
    await hvac.updateRoom('r1', { workshop_id: 'w2' })
    const [path, options] = call()
    expect(path).toBe('/rooms/r1')
    expect(options.body).toEqual({ workshop_id: 'w2' })
  })
})

describe('空调接口', () => {
  it('列表带三个过滤维度', async () => {
    await hvac.listAcUnits({ q: 'AC', workshop_id: 'w1', room_id: 'r1' })
    const [path, options] = call()
    expect(path).toBe('/ac-units')
    expect(options.query).toEqual({
      q: 'AC',
      workshop_id: 'w1',
      room_id: 'r1',
    })
  })

  it('建档要带序号、名称与房间', async () => {
    await hvac.createAcUnit({
      serial: 'AC-A-101',
      name: '东侧机',
      room_id: 'r1',
    })
    const [path, options] = call()
    expect(path).toBe('/ac-units')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      serial: 'AC-A-101',
      name: '东侧机',
      room_id: 'r1',
    })
  })

  it('批量改派是动作端点，冒号写错只会在运行时 404', async () => {
    await hvac.relocateAcUnits(['a1', 'a2'], 'r2')
    const [path, options] = call()
    expect(path).toBe('/ac-units:relocate')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({
      ac_unit_ids: ['a1', 'a2'],
      room_id: 'r2',
    })
  })
})
