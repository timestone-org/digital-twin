/**
 * @fileoverview 公式库（`P/formulas`）的接口封装：库公式的增删改、启停、
 * 恢复出厂口径与引用反查。
 *
 * ⚠ 与 `dataset-tables` **平级**而不是它的子资源：一条库公式属于全库，不属于
 * 某一张台账。故单独一个文件，读写权限也另有一套（`formula:view` /
 * `formula:manage`，docs/DATASET_DESIGN.md §6、§9）。
 * ⚠ 打的是 platform-server，每个函数都要给 `baseUrl`；漏给会静默打到
 * auth-server，拿回来一个 404 信封。
 * ⚠ 后端**没有**库公式的校验端点：一条公式体不能脱离形参单独解析
 * （§5.11），故写不通只在保存时以 400 回来。界面不许自己解析公式。
 */

import type {
  DatasetFormulaDef,
  DatasetFormulaDefWithUsages,
  DatasetFormulaParam,
  DatasetFormulaUsage,
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

/**
 * 新建一条库公式的入参。
 * ⚠ `code` 是调用点上的那个字面量，**建后不可改**：改一次等于让每一处
 * `@旧标识(…)` 当场解析失败，故它只在这里出现、不在补丁里。
 */
export interface DatasetFormulaCreateInput {
  code: string
  name: string
  category: string
  expression: string
  params: readonly DatasetFormulaParam[]
  description: string | null
}

/** 改一条库公式。缺省的字段后端不动。 */
export interface DatasetFormulaPatchInput {
  name?: string | undefined
  category?: string | undefined
  expression?: string | undefined
  params?: readonly DatasetFormulaParam[] | undefined
  description?: string | null | undefined
  is_enabled?: boolean | undefined
}

/**
 * 公式库列表。集合只有几十条，后端不分页，故一次全给。
 * 搜索与分类筛选在前端本地做——每敲一个字发一次请求换不来什么。
 */
export async function listDatasetFormulas(
  signal?: AbortSignal,
): Promise<DatasetFormulaDef[]> {
  return await requestData<DatasetFormulaDef[]>(
    '/formulas',
    onPlatform({ signal }),
  )
}

/**
 * 哪些台账列在用这一条，含被别的库公式间接带进来的。
 * ⚠ 台账列与库公式之间只有一条**文本**联系，反查是后端重新解析出来的，
 * 不是 JOIN；故它是一次真实的请求，不能拿列表里的字段凑。
 * @param formulaId 库公式 id
 * @param signal 中止信号
 */
export async function listDatasetFormulaUsages(
  formulaId: string,
  signal?: AbortSignal,
): Promise<DatasetFormulaUsage[]> {
  return await requestData<DatasetFormulaUsage[]>(
    `/formulas/${formulaId}/usages`,
    onPlatform({ signal }),
  )
}

/**
 * 新建一条库公式。
 * @param input 标识、名称、分类、公式体与形参表
 * @param key 幂等键，缺省现生成一个
 */
export async function createDatasetFormula(
  input: DatasetFormulaCreateInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetFormulaDef> {
  return await requestData<DatasetFormulaDef>(
    '/formulas',
    onPlatform({ method: 'POST', body: input, headers: idempotent(key) }),
  )
}

/**
 * 改一条库公式。
 * ⚠ 回执**带引用面**：改动即刻对全部引用方生效，而历史行要等重算才跟上。
 * 拿它说清这次改动扩散到了哪几列，不然用户会以为改完就完了。
 * @param formulaId 库公式 id
 * @param patch 只带要改的字段
 * @param key 幂等键，缺省现生成一个
 */
export async function updateDatasetFormula(
  formulaId: string,
  patch: DatasetFormulaPatchInput,
  key: string = newIdempotencyKey(),
): Promise<DatasetFormulaDefWithUsages> {
  return await requestData<DatasetFormulaDefWithUsages>(
    `/formulas/${formulaId}`,
    onPlatform({ method: 'PATCH', body: patch, headers: idempotent(key) }),
  )
}

/**
 * 把改过的预设公式还原成出厂口径。
 * ⚠ **不动启用开关**：恢复的是口径，不是开关。顺手把它翻回启用，等于悄悄
 * 重新打开一个运维刻意关掉的东西（docs/DATASET_DESIGN.md §5.11）。
 * @param formulaId 库公式 id
 * @param key 幂等键，缺省现生成一个
 */
export async function restoreDatasetFormula(
  formulaId: string,
  key: string = newIdempotencyKey(),
): Promise<DatasetFormulaDef> {
  return await requestData<DatasetFormulaDef>(
    `/formulas/${formulaId}:restore`,
    onPlatform({ method: 'POST', headers: idempotent(key) }),
  )
}

/**
 * 删一条库公式。
 * ⚠ 后端两侧都查（台账列在用它、库里别的公式在调它），还有人用就 409，
 * 且**没有 force 出口**——界面同样不许摆一个强制入口。
 * @param formulaId 库公式 id
 * @param key 幂等键，缺省现生成一个
 */
export async function deleteDatasetFormula(
  formulaId: string,
  key: string = newIdempotencyKey(),
): Promise<void> {
  // ⚠ 走 request 而不是 requestData：这条返回 204，没有 data
  await request<null>(
    `/formulas/${formulaId}`,
    onPlatform({ method: 'DELETE', headers: idempotent(key) }),
  )
}
