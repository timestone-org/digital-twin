/**
 * @fileoverview 数据采集配置面的接口封装。组件不直接发请求，一律经这里。
 *
 * ⚠ 这一组打的是 platform-server，每个请求都要给 `baseUrl`：漏了会静默打到
 * auth-server 上，现象是「页面永远搜不到东西」而不是一个报错。
 * ⚠ 这里的「点位」是采集侧的 point，不是画布上的 node——两个 node 不是一回事
 * （docs/DASHBOARD_DESIGN.md §1）。
 * ⚠ 建数据源、批量建点、下发写值三处必须带 `Idempotency-Key`：网络抖动引发的
 * 重试在没有幂等键时会**建两个数据源**、**建两批点位**或**向 PLC 写两次**。
 */
import type {
  CollectBrowseResult,
  CollectConnectivity,
  CollectPoint,
  CollectPointBatch,
  CollectPointCreateInput,
  CollectPointSaved,
  CollectPointUpdateInput,
  CollectSource,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
  CollectWriteResult,
  Page,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'
import { request, requestData, type RequestOptions } from './client'
import { newIdempotencyKey } from './idempotency'

export { newIdempotencyKey }

/** 点位与数据源列表共用的查询面。 */
export interface CollectPageQuery {
  q?: string | undefined
  page?: number | undefined
  size?: number | undefined
}

export interface PointQuery extends CollectPageQuery {
  sourceId?: string | undefined
}

export interface SourceQuery extends CollectPageQuery {
  protocol?: string | undefined
  isEnabled?: boolean | undefined
}

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

function idempotent(key: string): Record<'Idempotency-Key', string> {
  return { 'Idempotency-Key': key }
}

/* ---------------- 数据源 ---------------- */

/** 分页列出数据源，每行带采集运行态。 */
export async function listSources(
  query: SourceQuery = {},
): Promise<Page<CollectSource>> {
  return await requestData<Page<CollectSource>>(
    '/collect-sources',
    onPlatform({
      query: {
        q: query.q,
        protocol: query.protocol,
        is_enabled: query.isEnabled,
        page: query.page,
        size: query.size,
      },
    }),
  )
}

export async function getSource(sourceId: string): Promise<CollectSource> {
  return await requestData<CollectSource>(
    `/collect-sources/${sourceId}`,
    onPlatform(),
  )
}

export async function createSource(
  input: CollectSourceCreateInput,
  key: string = newIdempotencyKey(),
): Promise<CollectSource> {
  return await requestData<CollectSource>(
    '/collect-sources',
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

export async function updateSource(
  sourceId: string,
  input: CollectSourceUpdateInput,
): Promise<CollectSource> {
  return await requestData<CollectSource>(
    `/collect-sources/${sourceId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

/** 删数据源。⚠ 下面还有点位时后端 409——不级联删，点位要一条条过绑定检查。 */
export async function deleteSource(sourceId: string): Promise<void> {
  await request(
    `/collect-sources/${sourceId}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/** 连通性测试。⚠ 连不上也是 200，结论在 `is_reachable` 里。 */
export async function testSource(
  sourceId: string,
): Promise<CollectConnectivity> {
  return await requestData<CollectConnectivity>(
    `/collect-sources/${sourceId}:test`,
    onPlatform({ method: 'POST' }),
  )
}

/**
 * 浏览地址空间的一层。
 * @param sourceId 数据源
 * @param parent 从哪个节点往下走；不给表示从根开始
 * @param signal 取消信号；连续展开节点时用它掐掉在途请求
 */
export async function browseSource(
  sourceId: string,
  parent: string | null,
  signal?: AbortSignal,
): Promise<CollectBrowseResult> {
  return await requestData<CollectBrowseResult>(
    `/collect-sources/${sourceId}:browse`,
    onPlatform({
      method: 'POST',
      body: { parent },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}

/* ---------------- 点位 ---------------- */

/**
 * 分页找点位。
 * @param query 数据源、关键字与分页
 * @param signal 取消信号；连续输入关键字时用它掐掉在途请求
 */
export async function listPoints(
  query: PointQuery = {},
  signal?: AbortSignal,
): Promise<Page<CollectPoint>> {
  return await requestData<Page<CollectPoint>>(
    '/collect-points',
    onPlatform({
      query: {
        source_id: query.sourceId,
        q: query.q,
        page: query.page,
        size: query.size,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}

/**
 * 批量建点。一批只对一个数据源，单批上限 `COLLECT_POINT_BATCH_MAX`。
 * ⚠ 整批原子：一条编码撞了就整批 409，不会「一半成功一半失败」。
 */
export async function createPoints(
  input: CollectPointCreateInput,
  key: string = newIdempotencyKey(),
): Promise<CollectPointBatch> {
  return await requestData<CollectPointBatch>(
    '/collect-points',
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

export async function updatePoint(
  pointId: string,
  input: CollectPointUpdateInput,
): Promise<CollectPointSaved> {
  return await requestData<CollectPointSaved>(
    `/collect-points/${pointId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

/** 删点位。⚠ 被大屏绑着时后端 409 并列出那些大屏。 */
export async function deletePoint(pointId: string): Promise<void> {
  await request(`/collect-points/${pointId}`, onPlatform({ method: 'DELETE' }))
}

/**
 * 下发写值。
 * ⚠ 幂等键**必填**：写超时不代表没写成功，盲目重试可能向 PLC 下发两次。
 * ⚠ 调用方失败后不许自动重试，只能由人拿着同一个键再来一次。
 */
export async function writePoint(
  pointId: string,
  value: unknown,
  key: string = newIdempotencyKey(),
): Promise<CollectWriteResult> {
  return await requestData<CollectWriteResult>(
    `/collect-points/${pointId}:write`,
    onPlatform({
      method: 'POST',
      body: { value },
      headers: idempotent(key),
    }),
  )
}
