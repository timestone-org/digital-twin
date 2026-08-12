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
  AcSourceObject,
  AcUnit,
  AcUnitFilters,
  AcUnitRelocateResult,
  CursorPage,
  Page,
  RawSample,
  RawSeries,
  Room,
  StartupBatches,
  StartupEpisode,
  StartupExclusion,
  StartupRebuildResult,
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

/* 原始数据 */

// ⚠ 用 type 而不是 interface：interface 没有隐式索引签名，
// 传给 `request` 的 `query`（Record<...>）会被类型检查拒掉（同 AcUnitFilters）。
/** 查询区间，UTC RFC3339，半开 `[from, to)`。两端都是必填。 */
export type RawRange = {
  from: string
  to: string
}

/**
 * 一页原始采样。
 * ⚠ 游标分页而不是页码：时序集合边写边翻页时，页码会静默重复或漏行。
 * `after` 只能填上一页响应里的 `next`，不许自己拼。
 * @param acUnitId 空调 id
 * @param query 区间、单页条数与上一页给的游标
 */
export async function listRawSamples(
  acUnitId: string,
  query: RawRange & { limit?: number | undefined; after?: string | undefined },
): Promise<CursorPage<RawSample>> {
  return await requestData<CursorPage<RawSample>>(
    `/ac-units/${acUnitId}/raw-samples`,
    onPlatform({ query }),
  )
}

/**
 * 按点数上限聚合过的时序。
 * @param acUnitId 空调 id
 * @param query 区间、要哪几个指标、以及最多要多少个桶
 */
export async function getRawSeries(
  acUnitId: string,
  query: RawRange & {
    metrics: readonly string[]
    max_points?: number | undefined
  },
): Promise<RawSeries> {
  return await requestData<RawSeries>(
    `/ac-units/${acUnitId}/raw-series`,
    // ⚠ metrics 是逗号分隔的**一个** query 参数，不是重复的同名参数
    onPlatform({ query: { ...query, metrics: query.metrics.join(',') } }),
  )
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

/* 开机事件 */

// ⚠ 用 type 而不是 interface：要当 `query` 传给 request（同 AcUnitFilters）
export type StartupEpisodeFilters = {
  outcome?: string | undefined
  /** 逗号分隔的空调序号，与后端一致。 */
  running_set?: string | undefined
  limit?: number | undefined
  after?: string | undefined
}

/**
 * 一页开机事件。游标分页，`after` 只填上一页的 `next`。
 * ⚠ 被人工排除的事件照样在结果里，由页面置灰保留。
 * @param roomId 房间 id
 * @param query 过滤条件与游标
 */
export async function listStartupEpisodes(
  roomId: string,
  query: StartupEpisodeFilters = {},
): Promise<CursorPage<StartupEpisode>> {
  return await requestData<CursorPage<StartupEpisode>>(
    `/rooms/${roomId}/startup-episodes`,
    onPlatform({ query }),
  )
}

/** 批次列表、当前批次、组合覆盖度与指纹，一次取回。 */
export async function getStartupBatches(
  roomId: string,
): Promise<StartupBatches> {
  return await requestData<StartupBatches>(
    `/rooms/${roomId}/startup-batches`,
    onPlatform(),
  )
}

/**
 * 触发一次重算。
 * ⚠ 只入队立刻返回（202），进度要回头轮 `getStartupBatches`——
 * 把它当同步接口等结果的话，页面会挂在那儿直到超时。
 * @param roomId 房间 id
 * @param window 要重算的时间窗，UTC RFC3339
 */
export async function rebuildStartupBatches(
  roomId: string,
  window: { window_start: string; window_end: string },
): Promise<StartupRebuildResult> {
  return await requestData<StartupRebuildResult>(
    `/rooms/${roomId}/startup-batches:rebuild`,
    onPlatform({ method: 'POST', body: window }),
  )
}

// ⚠ 起始时刻是路径里的一段，且带 `:` 与 `+`，必须转义后再拼
function exclusionPath(roomId: string, startedAt: string): string {
  return `/rooms/${roomId}/startup-exclusions/${encodeURIComponent(startedAt)}`
}

/**
 * 把某次开机标记为不可用于训练。
 * @param roomId 房间 id
 * @param startedAt 事件起始时刻，UTC RFC3339
 * @param reason 排除原因，长度上限 `STARTUP_EXCLUSION_REASON_MAX`
 */
export async function putStartupExclusion(
  roomId: string,
  startedAt: string,
  reason: string,
): Promise<StartupExclusion> {
  return await requestData<StartupExclusion>(
    exclusionPath(roomId, startedAt),
    onPlatform({ method: 'PUT', body: { reason } }),
  )
}

export async function deleteStartupExclusion(
  roomId: string,
  startedAt: string,
): Promise<void> {
  // ⚠ 走 request 而不是 requestData：这条返回 204，没有 data
  await request<null>(
    exclusionPath(roomId, startedAt),
    onPlatform({ method: 'DELETE' }),
  )
}
