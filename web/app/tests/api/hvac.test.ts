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

const FROM = '2026-08-12T00:00:00.000Z'
const TO = '2026-08-12T06:00:00.000Z'

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
    ['listAcDatasets', () => hvac.listAcDatasets()],
    ['listAcSourceObjects', () => hvac.listAcSourceObjects('raw_minute')],
    ['listRawSamples', () => hvac.listRawSamples('a1', { from: FROM, to: TO })],
    [
      'getRawSeries',
      () => hvac.getRawSeries('a1', { from: FROM, to: TO, metrics: ['m'] }),
    ],
    ['listAcDataBindings', () => hvac.listAcDataBindings('a1')],
    ['putAcDataBinding', () => hvac.putAcDataBinding('a1', 'raw_minute', 'V1')],
    ['deleteAcDataBinding', () => hvac.deleteAcDataBinding('a1', 'raw_minute')],
    ['listAcMetricLimits', () => hvac.listAcMetricLimits('a1')],
    ['putAcMetricLimits', () => hvac.putAcMetricLimits('a1', [])],
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

describe('数据集目录', () => {
  it('目录是全局的，不挂在某台空调下', async () => {
    await hvac.listAcDatasets()
    expect(call()[0]).toBe('/ac-datasets')
  })

  it('剥掉 items 外壳，调用方直接拿数组', async () => {
    const dataset = {
      key: 'raw_minute',
      name: '原始数据',
      description: '逐分钟记录',
      metrics: [],
    }
    requestMock.mockResolvedValue({ items: [dataset] })
    await expect(hvac.listAcDatasets()).resolves.toEqual([dataset])
  })

  it('可绑定对象按数据集问，数据集在路径上', async () => {
    await hvac.listAcSourceObjects('raw_minute')
    expect(call()[0]).toBe('/ac-datasets/raw_minute/source-objects')
  })

  it('可绑定对象同样剥掉 items 外壳，caption 可以是 null', async () => {
    const object = { name: 'KTStartData_K01', caption: null, row_count_hint: 1 }
    requestMock.mockResolvedValue({ items: [object] })
    await expect(hvac.listAcSourceObjects('raw_minute')).resolves.toEqual([
      object,
    ])
  })
})

describe('数据源绑定', () => {
  it('列表挂在空调下', async () => {
    await hvac.listAcDataBindings('a1')
    expect(call()[0]).toBe('/ac-units/a1/data-bindings')
  })

  it('列表同样剥掉 items 外壳', async () => {
    requestMock.mockResolvedValue({ items: [] })
    await expect(hvac.listAcDataBindings('a1')).resolves.toEqual([])
  })

  it('设绑定用 PUT，数据集在路径上、只送对象名', async () => {
    await hvac.putAcDataBinding('a1', 'raw_minute', 'KTStartData_K01')
    const [path, options] = call()
    expect(path).toBe('/ac-units/a1/data-bindings/raw_minute')
    expect(options.method).toBe('PUT')
    expect(options.body).toEqual({ source_object: 'KTStartData_K01' })
  })

  it('解绑用 DELETE，路径与设绑定同形', async () => {
    await hvac.deleteAcDataBinding('a1', 'raw_minute')
    const [path, options] = call()
    expect(path).toBe('/ac-units/a1/data-bindings/raw_minute')
    expect(options.method).toBe('DELETE')
  })

  it('解绑走 request——它返回 204，走 requestData 会抛「服务端未返回数据」', async () => {
    await hvac.deleteAcDataBinding('a1', 'raw_minute')
    expect(vi.mocked(client.requestData)).not.toHaveBeenCalled()
    expect(vi.mocked(client.request)).toHaveBeenCalledTimes(1)
  })
})

describe('达标范围', () => {
  it('列表挂在空调下', async () => {
    await hvac.listAcMetricLimits('a1')
    expect(call()[0]).toBe('/ac-units/a1/metric-limits')
  })

  it('写入是覆盖式整包：没带上的指标会被清掉，所以必须送全量', async () => {
    const limits = [
      { metric: 'workshop_temp_avg', lower_limit: '20.15', upper_limit: '24' },
      { metric: 'workshop_humidity_avg', lower_limit: null, upper_limit: '65' },
    ]
    await hvac.putAcMetricLimits('a1', limits)
    const [path, options] = call()
    expect(path).toBe('/ac-units/a1/metric-limits')
    expect(options.method).toBe('PUT')
    expect(options.body).toEqual({ items: limits })
  })

  it('上下限原样透传字符串，不在封装层转成数字', async () => {
    const limits = [
      { metric: 'workshop_temp_avg', lower_limit: '20.15', upper_limit: null },
    ]
    await hvac.putAcMetricLimits('a1', limits)
    const body = call()[1].body as { items: { lower_limit: unknown }[] }
    expect(body.items[0]?.lower_limit).toBe('20.15')
  })

  it('写入的返回值也剥掉 items 外壳', async () => {
    const saved = [
      { metric: 'workshop_temp_avg', lower_limit: '20.15', upper_limit: null },
    ]
    requestMock.mockResolvedValue({ items: saved })
    await expect(hvac.putAcMetricLimits('a1', [])).resolves.toEqual(saved)
  })
})

describe('原始数据', () => {
  it('表格按区间取，区间两端都必须给', async () => {
    await hvac.listRawSamples('a1', { from: FROM, to: TO })
    const [path, options] = call()
    expect(path).toBe('/ac-units/a1/raw-samples')
    expect(options.query).toEqual({ from: FROM, to: TO })
  })

  it('翻页把上一页的 next 原样当 after 带回去，不做任何解析', async () => {
    await hvac.listRawSamples('a1', {
      from: FROM,
      to: TO,
      after: 'eyJ0cyI6ICIyMDI2In0=',
      limit: 200,
    })
    expect(call()[1].query).toEqual({
      from: FROM,
      to: TO,
      after: 'eyJ0cyI6ICIyMDI2In0=',
      limit: 200,
    })
  })

  it('折线的 metrics 是逗号分隔的一个参数，不是重复的同名参数', async () => {
    await hvac.getRawSeries('a1', {
      from: FROM,
      to: TO,
      metrics: ['workshop_temp_avg', 'workshop_humidity_avg'],
      max_points: 500,
    })
    const [path, options] = call()
    expect(path).toBe('/ac-units/a1/raw-series')
    expect(options.query).toEqual({
      from: FROM,
      to: TO,
      metrics: 'workshop_temp_avg,workshop_humidity_avg',
      max_points: 500,
    })
  })

  it('一个指标都没勾时 metrics 是空串，交给后端拒绝而不是本地静默不发', async () => {
    await hvac.getRawSeries('a1', { from: FROM, to: TO, metrics: [] })
    expect(call()[1].query).toEqual({ from: FROM, to: TO, metrics: '' })
  })
})
