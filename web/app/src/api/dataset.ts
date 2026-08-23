/**
 * @fileoverview 数据台账（`dataset`）的接口封装：台账、列、数据行与人工修正。
 * 回填随后续各期落地，届时加在这个文件里。
 *
 * ⚠ 这一组打的是 platform-server，不是 auth-server：每个函数都要给 `baseUrl`。
 * 漏给就会打到 `/api/v1/auth/...`，边缘按前缀反代，拿回来的是一个 404 信封。
 * ⚠ 写动作一律带 `Idempotency-Key`：网络抖动引发的重试不该建出第二张台账，
 * 也不该让一次删除被重放（docs/DATASET_DESIGN.md §6.3）。
 */

import type {
  CursorPage,
  DatasetAggFunc,
  DatasetCollectMode,
  DatasetColumn,
  DatasetColumnSource,
  DatasetColumnType,
  DatasetFormulaCatalog,
  DatasetFormulaPreview,
  DatasetFormulaValidation,
  DatasetOverrideBulkClear,
  DatasetOverrideWrite,
  DatasetRecompute,
  DatasetRecord,
  DatasetRecordDelete,
  DatasetRecordWrite,
  DatasetSeries,
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

/**
 * 一张台账的公式函数目录：函数、分类、运算符、时间窗写法、规则，
 * 外加这张台账可引用的列与可跨表引用的台账。
 * ⚠ 函数名单**只能**从这里来：前端硬编码一份的话，后端加一族函数（比如对数与
 * 三角）之后整族在界面上不可见，而用户只会报「算不了 ln」
 * （docs/DATASET_DESIGN.md §5.3）。
 * @param tableId 台账 id
 * @param signal 中止信号
 */
export async function getDatasetFormulaCatalog(
  tableId: string,
  signal?: AbortSignal,
): Promise<DatasetFormulaCatalog> {
  return await requestData<DatasetFormulaCatalog>(
    `/dataset-tables/${tableId}/formula-functions`,
    onPlatform({ signal }),
  )
}

/** 校验或试算一条公式草稿时都要说清「正在编辑的是哪一列」。 */
export interface DatasetFormulaDraft {
  formula: string
  /** 新建那一列时它还不在库里，但 key 已经定下来了；给了才做环检测。 */
  column_key?: string | undefined
}

/**
 * 校验一条公式。
 * ⚠ 公式写错回的是 **200 + `is_ok: false`**，不是 HTTP 错误——编辑器里
 * 「还没写完」是正常状态。把它当成请求失败会让编辑器每敲一个字就弹一次
 * 吐司（docs/DATASET_DESIGN.md §6.1）。
 * @param tableId 台账 id
 * @param draft 公式原文与正在编辑的列 key
 * @param signal 中止信号
 */
export async function validateDatasetFormula(
  tableId: string,
  draft: DatasetFormulaDraft,
  signal?: AbortSignal,
): Promise<DatasetFormulaValidation> {
  return await requestData<DatasetFormulaValidation>(
    `/dataset-tables/${tableId}/formula:validate`,
    onPlatform({ method: 'POST', body: draft, signal }),
  )
}

/**
 * 用一组样例值试算一条公式。
 * ⚠ 试算**不取历史**：`PREV` / 时间窗 / 整列 / 跨表一律按空处理，回执的
 * `history_refs` 会如实列出来，界面必须照实说。
 * @param tableId 台账 id
 * @param draft 公式原文、列 key 与样例值
 * @param signal 中止信号
 */
export async function previewDatasetFormula(
  tableId: string,
  draft: DatasetFormulaDraft & { values: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<DatasetFormulaPreview> {
  return await requestData<DatasetFormulaPreview>(
    `/dataset-tables/${tableId}/formula:preview`,
    onPlatform({ method: 'POST', body: draft, signal }),
  )
}

/**
 * 数据行分页的取数参数。`after` 是不透明游标，只原样带回。
 * ⚠ 写成 `type` 而不是 `interface`：只有前者才隐式带索引签名，接口交给
 * `RequestOptions.query`（一个 `Record`）会当场类型不兼容。
 */
export type DatasetRecordQuery = {
  /** 每页条数，后端上限 200。 */
  limit?: number | undefined
  /** 上一页回执里的 `next`。⚠ 不许解析它。 */
  after?: string | undefined
  /** 数据时间下界，UTC RFC3339。 */
  since?: string | undefined
  until?: string | undefined
}

/**
 * 一页数据行，按数据时间倒序。
 * ⚠ 走的是**游标分页**而不是页码：`dataset_records` 是持续写入的时序集合，
 * 页码分页会静默重复与漏行（docs/DATASET_DESIGN.md §6.1）。故出参没有
 * `total`，界面只说得出「第几页」，说不出「共几页」。
 * @param tableId 台账 id
 * @param query 每页条数与游标
 */
export async function listDatasetRecords(
  tableId: string,
  query: DatasetRecordQuery = {},
): Promise<CursorPage<DatasetRecord>> {
  return await requestData<CursorPage<DatasetRecord>>(
    `/dataset-tables/${tableId}/records`,
    onPlatform({ query }),
  )
}

/**
 * 录入或改写一行的入参。
 * ⚠ `values` 里的点位汇总列会被后端记成**人工修正**而不是覆盖采集原值
 * （docs/DATASET_DESIGN.md §8.4）。故表单只提交用户真的动过的那几格：
 * 原样回传一遍会把没人动过的格子静默打上修正角标。
 */
export interface DatasetRecordInput {
  /** 数据时间；建行时缺省取此刻。 */
  ts?: string | undefined
  values: Record<string, unknown>
}

/**
 * 录入一行。公式列在保存时随之算出。
 * @param tableId 台账 id
 * @param input 数据时间与各列取值
 * @param key 幂等键，缺省现生成一个
 */
export async function createDatasetRecord(
  tableId: string,
  input: DatasetRecordInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetRecordWrite> {
  return await requestData<DatasetRecordWrite>(
    `/dataset-tables/${tableId}/records`,
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

/**
 * 一行的定位。
 * ⚠ `ts` 不能省：它是超表的分区键，带上直接命中 chunk，不带就是跨 chunk 扫描
 * （docs/DATASET_DESIGN.md §6.1）。
 */
export interface DatasetRowRef {
  tableId: string
  rowId: string
  ts: string
}

/**
 * 改一行的原始值，可连带改数据时间。
 * @param row 行定位（含分区键 `ts`）
 * @param input 新的数据时间与取值
 * @param key 幂等键，缺省现生成一个
 */
export async function updateDatasetRecord(
  row: DatasetRowRef,
  input: DatasetRecordInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetRecordWrite> {
  return await requestData<DatasetRecordWrite>(
    `/dataset-tables/${row.tableId}/records/${row.rowId}`,
    onPlatform({
      method: 'PATCH',
      query: { ts: row.ts },
      body: input,
      headers: idempotent(key),
    }),
  )
}

/**
 * 删一行。
 * ⚠ 回执不是 204 而是带 `has_stale_downstream`：删掉一行同样会让它之后那些行的
 * `PREV` / 时间窗 / 整表公式结果失真，而那件事只能由回执说出来。
 * @param row 行定位（含分区键 `ts`）
 * @param key 幂等键，缺省现生成一个
 */
export async function deleteDatasetRecord(
  row: DatasetRowRef,
  key: string = newIdempotencyKey(),
): Promise<DatasetRecordDelete> {
  return await requestData<DatasetRecordDelete>(
    `/dataset-tables/${row.tableId}/records/${row.rowId}`,
    onPlatform({
      method: 'DELETE',
      query: { ts: row.ts },
      headers: idempotent(key),
    }),
  )
}

/**
 * 撤销一行里若干格的人工修正，这些格回落到自动采集值。
 * ⚠ 回执的 `cleared` 点名真正撤掉的那几列：空数组意味着这几格早就没有修正了
 * （别人先撤过、或手上这一页已经旧了），那不是失败。
 * @param row 行定位（含分区键 `ts`）
 * @param keys 要撤的列标识；缺省整行全撤
 * @param key 幂等键，缺省现生成一个
 */
export async function clearDatasetRecordOverrides(
  row: DatasetRowRef,
  keys: readonly string[] | null = null,
  key: string = newIdempotencyKey(),
): Promise<DatasetOverrideWrite> {
  return await requestData<DatasetOverrideWrite>(
    `/dataset-tables/${row.tableId}/records/${row.rowId}/overrides`,
    onPlatform({
      method: 'DELETE',
      query: { ts: row.ts },
      body: { keys },
      headers: idempotent(key),
    }),
  )
}

/** 批量撤销的入参。两端留空即不限。 */
export interface DatasetOverrideBulkInput {
  column_keys: readonly string[]
  since?: string | undefined
  until?: string | undefined
}

/**
 * 按列 + 时间范围批量撤销人工修正（仪表修好之后整段退回自动值）。
 * ⚠ `since` / `until` 留空是**不限**。界面不许把「不限」做成默认值：一次误点
 * 就抹掉三年的修正，而回执只有一个数字，看不出抹掉了什么
 * （docs/DATASET_DESIGN.md §7.8）。
 * @param tableId 台账 id
 * @param input 列名单与时间范围
 * @param key 幂等键，缺省现生成一个
 */
export async function clearDatasetOverridesInRange(
  tableId: string,
  input: DatasetOverrideBulkInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetOverrideBulkClear> {
  return await requestData<DatasetOverrideBulkClear>(
    `/dataset-tables/${tableId}/overrides:clear`,
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

/** 一段时间范围。两端留空即整表。 */
export interface DatasetRangeInput {
  since?: string | undefined
  until?: string | undefined
}

/**
 * 重算公式列。只写计算值，不碰任何原始录入值。
 * ⚠ 回执的 `is_truncated` 必须照实说出来：触顶的一次与算完的一次长得一模一样，
 * 不说的话用户以为已经算完了（docs/DATASET_DESIGN.md §6.2）。
 * @param tableId 台账 id
 * @param range 时间范围，缺省整表
 * @param key 幂等键，缺省现生成一个
 */
export async function recomputeDatasetTable(
  tableId: string,
  range: DatasetRangeInput = {},
  key: string = newIdempotencyKey(),
): Promise<DatasetRecompute> {
  return await requestData<DatasetRecompute>(
    `/dataset-tables/${tableId}:recompute`,
    onPlatform({ method: 'POST', body: range, headers: idempotent(key) }),
  )
}

/**
 * 若干列的时间序列，按时刻升序。趋势图的取数就这一条。
 * ⚠ 触顶时后端留下的是**最新**那一批（内层按 ts 倒序反扫），被砍掉的是更早
 * 那一段。`is_truncated` 必须照实说出来，且要说清砍的是哪一头——曲线开头凭空
 * 少一截会被读成「采集坏了」（docs/DATASET_DESIGN.md §6.2）。
 * ⚠ `keys` 是**重复**查询参数（`keys=a&keys=b`）：`RequestOptions.query` 一个键
 * 只放得下一个标量，逗号拼起来会被后端当成一个名字里带逗号的列，回参里那一列
 * 恒为空数组、且不报任何错。故这一条自己拼查询串。
 * @param tableId 台账 id
 * @param keys 要取的列标识，后端上限 50
 * @param range 时间范围，缺省整表
 * @param signal 中止信号
 */
export async function getDatasetSeries(
  tableId: string,
  keys: readonly string[],
  range: DatasetRangeInput = {},
  signal?: AbortSignal,
): Promise<DatasetSeries> {
  const params = new URLSearchParams()
  for (const key of keys) params.append('keys', key)
  if (range.since !== undefined) params.set('since', range.since)
  if (range.until !== undefined) params.set('until', range.until)
  return await requestData<DatasetSeries>(
    `/dataset-tables/${tableId}/series?${params.toString()}`,
    onPlatform({ signal }),
  )
}
