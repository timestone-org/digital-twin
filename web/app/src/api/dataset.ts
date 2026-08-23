/**
 * @fileoverview 数据台账（`dataset`）配置面的接口封装：台账本身的增删改查。
 * 列、记录、公式与回填随后续各期落地，届时加在这个文件里。
 *
 * ⚠ 这一组打的是 platform-server，不是 auth-server：每个函数都要给 `baseUrl`。
 * 漏给就会打到 `/api/v1/auth/...`，边缘按前缀反代，拿回来的是一个 404 信封。
 * ⚠ 写动作一律带 `Idempotency-Key`：网络抖动引发的重试不该建出第二张台账，
 * 也不该让一次删除被重放（docs/DATASET_DESIGN.md §6.3）。
 */

import type {
  DatasetCollectMode,
  DatasetTable,
  DatasetTableSummary,
  Page,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'

import { request, requestData, type RequestOptions } from './client'
import { newIdempotencyKey } from './idempotency'

/** 给一次调用补上 platform 前缀。 */
function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/** 写操作的幂等头。 */
function idempotent(key: string): Record<'Idempotency-Key', string> {
  return { 'Idempotency-Key': key }
}

/** 台账列表的翻页参数。后端 `size` 上限 200。 */
export type DatasetTableQuery = {
  page?: number | undefined
  size?: number | undefined
}

export interface DatasetTableCreateInput {
  /**
   * ASCII 标识，全局唯一。大屏绑定键 `ds:{code}:{列key}` 的前半段。
   * ⚠ **建后不可改**，故它只出现在建表入参里，不在补丁里。
   */
  code: string
  name: string
  description?: string | null | undefined
  collect_mode?: DatasetCollectMode | undefined
  /** 一行覆盖的桶宽，`[1000, 86_400_000]` 毫秒。 */
  collect_interval_ms?: number | undefined
  /** null = 永久保留。 */
  retention_days?: number | null | undefined
  is_enabled?: boolean | undefined
}

/**
 * 改台账。缺省的字段不动。
 * ⚠ `description` 与 `retention_days` 的 `null` 与 `undefined` 不是一回事：
 * `null` 是「清空 / 改成永久」，`undefined` 是「这次不动它」。
 */
export interface DatasetTablePatchInput {
  name?: string | undefined
  description?: string | null | undefined
  collect_mode?: DatasetCollectMode | undefined
  collect_interval_ms?: number | undefined
  retention_days?: number | null | undefined
  is_enabled?: boolean | undefined
}

/**
 * 一页台账。
 * ⚠ 列表项是**摘要**：带列数、不带整份列定义。当详情用会在渲染里崩在
 * `columns` 上，那时离真正的原因已经很远了。
 * @param query 页码与每页条数
 */
export async function listDatasetTables(
  query: DatasetTableQuery = {},
): Promise<Page<DatasetTableSummary>> {
  return await requestData<Page<DatasetTableSummary>>(
    '/dataset-tables',
    onPlatform({ query }),
  )
}

/**
 * 建一张台账。回参已经带上（空的）列定义。
 * @param input 编码、名称与取数方式
 * @param key 幂等键，缺省现生成一个
 */
export async function createDatasetTable(
  input: DatasetTableCreateInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetTable> {
  return await requestData<DatasetTable>(
    '/dataset-tables',
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

/**
 * 改一张台账。
 * @param tableId 台账 id
 * @param patch 只带要改的字段
 * @param key 幂等键，缺省现生成一个
 */
export async function updateDatasetTable(
  tableId: string,
  patch: DatasetTablePatchInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetTable> {
  return await requestData<DatasetTable>(
    `/dataset-tables/${tableId}`,
    onPlatform({ method: 'PATCH', body: patch, headers: idempotent(key) }),
  )
}

/**
 * 删一张台账。
 * ⚠ 台账下还有数据行时后端回 409（`datasetTableNotEmpty`）而不是静默连坐：
 * 定义没了、行还在，查不出来也删不掉，而删除操作本身看起来完全成功。
 * 要连历史一起删就显式 `isForced`，且必须在二次确认里说清这一句。
 * @param tableId 台账 id
 * @param isForced 连同历史数据行一并删除
 * @param key 幂等键，缺省现生成一个——两段式删除的两次调用各用各的，
 *   共用一个会让第二次拿回第一次那份 409
 */
export async function deleteDatasetTable(
  tableId: string,
  isForced = false,
  key: string = newIdempotencyKey(),
): Promise<void> {
  // ⚠ 走 request 而不是 requestData：这条返回 204，没有 data，
  // requestData 会把它当成「服务端未返回数据」抛出来
  await request<null>(
    `/dataset-tables/${tableId}`,
    onPlatform({
      method: 'DELETE',
      query: { force: isForced },
      headers: idempotent(key),
    }),
  )
}
