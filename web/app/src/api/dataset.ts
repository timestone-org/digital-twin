/**
 * @fileoverview 数据台账（`dataset`）配置面的接口封装：台账与列的增删改查。
 * 记录、公式与回填随后续各期落地，届时加在这个文件里。
 *
 * ⚠ 这一组打的是 platform-server，不是 auth-server：每个函数都要给 `baseUrl`。
 * 漏给就会打到 `/api/v1/auth/...`，边缘按前缀反代，拿回来的是一个 404 信封。
 * ⚠ 写动作一律带 `Idempotency-Key`：网络抖动引发的重试不该建出第二张台账，
 * 也不该让一次删除被重放（docs/DATASET_DESIGN.md §6.3）。
 */

import type {
  DatasetAggFunc,
  DatasetCollectMode,
  DatasetColumn,
  DatasetColumnSource,
  DatasetColumnType,
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

/**
 * 一张台账的详情。回参连列定义一起给，故进详情页只要这一次调用。
 * @param tableId 台账 id
 */
export async function getDatasetTable(tableId: string): Promise<DatasetTable> {
  return await requestData<DatasetTable>(
    `/dataset-tables/${tableId}`,
    onPlatform(),
  )
}

/**
 * 新增一列的入参。
 * ⚠ `key` 是数据行 JSONB 里的字段名，也是公式里的 `{key}`，**建后不可改**，
 * 故它只在这里出现、不在补丁里（docs/DATASET_DESIGN.md §4.2）。
 */
export interface DatasetColumnCreateInput {
  key: string
  name: string
  unit?: string | null | undefined
  /** 展示小数位，null = 不限。库里始终存全精度。 */
  decimals?: number | null | undefined
  data_type?: DatasetColumnType | undefined
  source?: DatasetColumnSource | undefined
  /** 仅 `source === 'point'` 有意义；后端 NOT NULL，其余来源给缺省值。 */
  agg?: DatasetAggFunc | undefined
  /** 点位身份 `{source_id}:{point_code}`。 */
  node_key?: string | null | undefined
  formula?: string | null | undefined
  is_required?: boolean | undefined
  default_value?: unknown
  /** 缺省即排到最后。 */
  order_index?: number | null | undefined
}

/**
 * 改一列。缺省的字段不动。
 * ⚠ 没有 `key`：见 `DatasetColumnCreateInput` 上的那一条。
 */
export interface DatasetColumnPatchInput {
  name?: string | undefined
  unit?: string | null | undefined
  decimals?: number | null | undefined
  data_type?: DatasetColumnType | undefined
  source?: DatasetColumnSource | undefined
  agg?: DatasetAggFunc | undefined
  node_key?: string | null | undefined
  formula?: string | null | undefined
  is_required?: boolean | undefined
  default_value?: unknown
  order_index?: number | undefined
}

/**
 * 一张台账的全部列。集合有界（后端不分页），故一次取完。
 * @param tableId 台账 id
 */
export async function listDatasetColumns(
  tableId: string,
): Promise<DatasetColumn[]> {
  return await requestData<DatasetColumn[]>(
    `/dataset-tables/${tableId}/columns`,
    onPlatform(),
  )
}

/**
 * 新增一列。
 * @param tableId 台账 id
 * @param input 列标识、名称与来源那几项
 * @param key 幂等键，缺省现生成一个
 */
export async function createDatasetColumn(
  tableId: string,
  input: DatasetColumnCreateInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetColumn> {
  return await requestData<DatasetColumn>(
    `/dataset-tables/${tableId}/columns`,
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

/**
 * 改一列。
 * @param tableId 台账 id
 * @param columnId 列 id
 * @param patch 只带要改的字段
 * @param key 幂等键，缺省现生成一个
 */
export async function updateDatasetColumn(
  tableId: string,
  columnId: string,
  patch: DatasetColumnPatchInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetColumn> {
  return await requestData<DatasetColumn>(
    `/dataset-tables/${tableId}/columns/${columnId}`,
    onPlatform({ method: 'PATCH', body: patch, headers: idempotent(key) }),
  )
}

/**
 * 删一列。
 * ⚠ 还被别的列的公式引用着时后端回 409（`datasetColumnInUse`），并把引用它的
 * 那几列摊在信封的 `details` 里。前端据此把二次确认的文案换成具体的那一句，
 * 而不是自己先查一遍「谁引用了它」——查完到用户点确认之间，公式可能已经改了。
 * @param tableId 台账 id
 * @param columnId 列 id
 * @param isForced 跳过「被公式引用」的守卫
 * @param key 幂等键，缺省现生成一个——两段式删除的两次调用各用各的，
 *   共用一个会让第二次拿回第一次那份 409
 */
export async function deleteDatasetColumn(
  tableId: string,
  columnId: string,
  isForced = false,
  key: string = newIdempotencyKey(),
): Promise<void> {
  // ⚠ 走 request 而不是 requestData：这条返回 204，没有 data
  await request<null>(
    `/dataset-tables/${tableId}/columns/${columnId}`,
    onPlatform({
      method: 'DELETE',
      query: { force: isForced },
      headers: idempotent(key),
    }),
  )
}

/**
 * 按给定顺序整体重排。
 * ⚠ 名单外的列后端静默保持原样：并发编辑时另一个人刚加的列不该因为这次
 * 重排而跳到列表顶端。
 * @param tableId 台账 id
 * @param columnIds 目标顺序的全套列 id
 * @param key 幂等键，缺省现生成一个
 */
export async function reorderDatasetColumns(
  tableId: string,
  columnIds: readonly string[],
  key: string = newIdempotencyKey(),
): Promise<DatasetColumn[]> {
  return await requestData<DatasetColumn[]>(
    `/dataset-tables/${tableId}/columns:reorder`,
    onPlatform({
      method: 'POST',
      body: { column_ids: columnIds },
      headers: idempotent(key),
    }),
  )
}
