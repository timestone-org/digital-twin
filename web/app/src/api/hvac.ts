/**
 * @fileoverview 空调台账、空间配置与空调数据面的接口封装。
 * 组件不直接发请求，一律经这里。分页一律带 page/size，后端 size 上限 200。
 *
 * ⚠ 这一组打的是 platform-server，不是 auth-server：每个函数都要给 `baseUrl`。
 * 漏给就会打到 `/api/v1/auth/...`，边缘按前缀反代，拿回来的是一个 404 信封。
 */

import type {
  AcDataBinding,
  AcDataset,
  AcItemList,
  AcMetricLimit,
  AcUnit,
  AcUnitFilters,
  AcUnitRelocateResult,
  Page,
  Room,
  Workshop,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'

import { request, requestData, type RequestOptions } from './client'

export type PageQuery = {
  page?: number | undefined
  size?: number | undefined
  sort?: string | undefined
}

/** 给一次调用补上 platform 前缀。 */
function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/* 车间 */

export async function listWorkshops(
  query: PageQuery & { q?: string | undefined } = {},
): Promise<Page<Workshop>> {
  return await requestData<Page<Workshop>>('/workshops', onPlatform({ query }))
}

export async function createWorkshop(name: string): Promise<Workshop> {
  return await requestData<Workshop>(
    '/workshops',
    onPlatform({ method: 'POST', body: { name } }),
  )
}

export async function updateWorkshop(
  workshopId: string,
  name: string,
): Promise<Workshop> {
  return await requestData<Workshop>(
    `/workshops/${workshopId}`,
    onPlatform({ method: 'PATCH', body: { name } }),
  )
}

export async function deleteWorkshop(workshopId: string): Promise<void> {
  await request<null>(
    `/workshops/${workshopId}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/* 房间 */

export async function listRooms(
  query: PageQuery & {
    workshop_id?: string | undefined
    q?: string | undefined
  } = {},
): Promise<Page<Room>> {
  return await requestData<Page<Room>>('/rooms', onPlatform({ query }))
}

export interface RoomInput {
  workshop_id: string
  name: string
}

export async function createRoom(input: RoomInput): Promise<Room> {
  return await requestData<Room>(
    '/rooms',
    onPlatform({ method: 'POST', body: input }),
  )
}

export async function updateRoom(
  roomId: string,
  input: { name?: string | undefined; workshop_id?: string | undefined },
): Promise<Room> {
  return await requestData<Room>(
    `/rooms/${roomId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

export async function deleteRoom(roomId: string): Promise<void> {
  await request<null>(`/rooms/${roomId}`, onPlatform({ method: 'DELETE' }))
}

/* 空调 */

export async function listAcUnits(
  query: AcUnitFilters & PageQuery = {},
): Promise<Page<AcUnit>> {
  return await requestData<Page<AcUnit>>('/ac-units', onPlatform({ query }))
}

export interface AcUnitInput {
  serial: string
  name: string
  room_id: string
}

export async function createAcUnit(input: AcUnitInput): Promise<AcUnit> {
  return await requestData<AcUnit>(
    '/ac-units',
    onPlatform({ method: 'POST', body: input }),
  )
}

export async function updateAcUnit(
  acUnitId: string,
  input: Partial<AcUnitInput>,
): Promise<AcUnit> {
  return await requestData<AcUnit>(
    `/ac-units/${acUnitId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

export async function deleteAcUnit(acUnitId: string): Promise<void> {
  await request<null>(`/ac-units/${acUnitId}`, onPlatform({ method: 'DELETE' }))
}

/**
 * 把一批空调改派到同一个房间。动作端点用 `:verb`，与后端口径一致。
 * ⚠ 任一 id 不存在即整批拒绝，后端不会静默跳过。
 */
export async function relocateAcUnits(
  acUnitIds: string[],
  roomId: string,
): Promise<AcUnitRelocateResult> {
  return await requestData<AcUnitRelocateResult>(
    '/ac-units:relocate',
    onPlatform({
      method: 'POST',
      body: { ac_unit_ids: acUnitIds, room_id: roomId },
    }),
  )
}

/* 数据集目录 */

/** 全部数据集与它们的指标。目录随后端版本走，前端不硬编码任何指标。 */
export async function listAcDatasets(): Promise<AcDataset[]> {
  const data = await requestData<AcItemList<AcDataset>>(
    '/ac-datasets',
    onPlatform(),
  )
  return data.items
}

/**
 * 外部库里一个可绑定的对象。
 * ⚠ 类型落在 api 层而不是 `@dt/contracts`：这条端点的契约还没随 openapi.json
 * 一起提交，稳定后再挪进契约包并补 `hvac-shapes` 的键集断言。
 */
export interface AcSourceObject {
  name: string
  /** 厂商给的中文别名，取不到时为 null。 */
  caption: string | null
  row_count_hint: number | null
}

/**
 * 某个数据集在外部库里可绑定的对象。
 * ⚠ 后端按**列形状**过滤而不是按名字：同前缀但没有时间列的那几个视图不会出现
 * 在这里，所以这一项只能选、不能让人手打。
 * @param dataset 数据集 key，取自目录
 */
export async function listAcSourceObjects(
  dataset: string,
): Promise<AcSourceObject[]> {
  const data = await requestData<AcItemList<AcSourceObject>>(
    `/ac-datasets/${dataset}/source-objects`,
    onPlatform(),
  )
  return data.items
}

/* 数据源绑定 */

export async function listAcDataBindings(
  acUnitId: string,
): Promise<AcDataBinding[]> {
  const data = await requestData<AcItemList<AcDataBinding>>(
    `/ac-units/${acUnitId}/data-bindings`,
    onPlatform(),
  )
  return data.items
}

/**
 * 设定一台空调某个数据集读哪个对象。已有绑定会被换掉。
 * @param acUnitId 空调 id
 * @param dataset 数据集 key，取自目录
 * @param sourceObject 外部库里的视图名
 */
export async function putAcDataBinding(
  acUnitId: string,
  dataset: string,
  sourceObject: string,
): Promise<AcDataBinding> {
  return await requestData<AcDataBinding>(
    `/ac-units/${acUnitId}/data-bindings/${dataset}`,
    onPlatform({ method: 'PUT', body: { source_object: sourceObject } }),
  )
}

export async function deleteAcDataBinding(
  acUnitId: string,
  dataset: string,
): Promise<void> {
  // ⚠ 走 request 而不是 requestData：这条返回 204，没有 data，
  // requestData 会把它当成「服务端未返回数据」抛出来
  await request<null>(
    `/ac-units/${acUnitId}/data-bindings/${dataset}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/* 达标范围 */

export async function listAcMetricLimits(
  acUnitId: string,
): Promise<AcMetricLimit[]> {
  const data = await requestData<AcItemList<AcMetricLimit>>(
    `/ac-units/${acUnitId}/metric-limits`,
    onPlatform(),
  )
  return data.items
}

/**
 * 覆盖式写一台空调的全部达标范围。
 * ⚠ 覆盖式：`limits` 里没出现的指标会被**清除**，不是「没给就是不改」。
 * 提交前必须把界面上现存的每一项都带上。
 * @param acUnitId 空调 id
 * @param limits 全量的达标范围，条数上限 `AC_METRIC_LIMITS_MAX`
 */
export async function putAcMetricLimits(
  acUnitId: string,
  limits: readonly AcMetricLimit[],
): Promise<AcMetricLimit[]> {
  const data = await requestData<AcItemList<AcMetricLimit>>(
    `/ac-units/${acUnitId}/metric-limits`,
    onPlatform({ method: 'PUT', body: { items: limits } }),
  )
  return data.items
}
