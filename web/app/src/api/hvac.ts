/**
 * @fileoverview 空调台账与空间配置的接口封装。
 * 组件不直接发请求，一律经这里。分页一律带 page/size，后端 size 上限 200。
 *
 * ⚠ 这一组打的是 platform-server，不是 auth-server：每个函数都要给 `baseUrl`。
 * 漏给就会打到 `/api/v1/auth/...`，边缘按前缀反代，拿回来的是一个 404 信封。
 */

import type {
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
