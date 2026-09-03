/**
 * @fileoverview 分析建模（`modeling`）的接口封装：算子目录、流水线、运行、
 * 模型版本与公式绑定。
 *
 * ⚠ 这一组打的是 platform-server，每个函数都要给 `baseUrl`；漏给会打到
 * auth-server 上，拿回来的是一个 404 信封（同 `dataset.ts`）。
 * ⚠ 写动作一律带 `Idempotency-Key`：发起运行、发布版本这两条重放一次的代价
 * 分别是一轮白跑的训练与一个多出来的版本号（MODELING_DESIGN §7.5）。
 */

import type {
  ModelApiKey,
  ModelApiKeyMinted,
  ModelCallStat,
  ModelDeployment,
  ModelFormulaRegistration,
  ModelingBinding,
  ModelingBindingImpact,
  ModelingGraph,
  ModelingGraphCheck,
  ModelingNodeRun,
  ModelingOperator,
  ModelingPipeline,
  ModelingPipelineSummary,
  ModelingRun,
  ModelingRunSummary,
  ModelingTrigger,
  ModelingVersion,
  ModelingVersionSummary,
  Page,
} from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'

import { request, requestData, type RequestOptions } from './client'
import { newIdempotencyKey } from './idempotency'

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

function idempotent(key: string): Record<'Idempotency-Key', string> {
  return { 'Idempotency-Key': key }
}

/** 翻页参数。后端 `size` 上限 200。 */
export interface ModelingPageQuery {
  page?: number | undefined
  size?: number | undefined
}

export interface ModelingPipelineCreateInput {
  /** ASCII 标识，全局唯一，**建后不可改**。 */
  code: string
  name: string
  description?: string | null | undefined
  graph?: ModelingGraph | undefined
}

/** 改流水线。缺省的字段不动；`description` 给 `null` 是清空。 */
export interface ModelingPipelinePatchInput {
  name?: string | undefined
  description?: string | null | undefined
  graph?: ModelingGraph | undefined
}

/** 算子目录。前端的算子面板与参数表单都由它驱动。 */
export async function listModelingOperators(): Promise<ModelingOperator[]> {
  return await requestData<ModelingOperator[]>(
    '/modeling-operators',
    onPlatform(),
  )
}

/** 一页流水线。列表项是摘要，**不带图**。 */
export async function listModelingPipelines(
  query: ModelingPageQuery = {},
): Promise<Page<ModelingPipelineSummary>> {
  return await requestData<Page<ModelingPipelineSummary>>(
    '/modeling-pipelines',
    onPlatform({ query: { page: query.page, size: query.size } }),
  )
}

export async function getModelingPipeline(
  pipelineId: string,
): Promise<ModelingPipeline> {
  return await requestData<ModelingPipeline>(
    `/modeling-pipelines/${pipelineId}`,
    onPlatform(),
  )
}

export async function createModelingPipeline(
  input: ModelingPipelineCreateInput,
): Promise<ModelingPipeline> {
  return await requestData<ModelingPipeline>(
    '/modeling-pipelines',
    onPlatform({
      method: 'POST',
      body: input,
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

export async function updateModelingPipeline(
  pipelineId: string,
  input: ModelingPipelinePatchInput,
): Promise<ModelingPipeline> {
  return await requestData<ModelingPipeline>(
    `/modeling-pipelines/${pipelineId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

export async function deleteModelingPipeline(
  pipelineId: string,
): Promise<void> {
  // ⚠ 走 request 不走 requestData：这条返回 204，没有 data
  await request<null>(
    `/modeling-pipelines/${pipelineId}`,
    onPlatform({ method: 'DELETE', headers: idempotent(newIdempotencyKey()) }),
  )
}

/**
 * 静态检查一张图。**不落库、不排队**，画布上随时可以按。
 * @param graph 当前画布上那张图，可以是还没保存的
 * @param signal 边改边校验用；下一次发起时要能把上一次作废
 */
export async function validateModelingGraph(
  pipelineId: string,
  graph: ModelingGraph,
  signal?: AbortSignal,
): Promise<ModelingGraphCheck> {
  return await requestData<ModelingGraphCheck>(
    `/modeling-pipelines/${pipelineId}:validate`,
    onPlatform({
      method: 'POST',
      body: { graph },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
}

/** 发起一次运行。同一条流水线同时只允许一轮在跑，撞上会拿到 409。 */
export async function startModelingRun(
  pipelineId: string,
  trigger: ModelingTrigger = 'manual',
  isKeepingFrames = false,
): Promise<ModelingRun> {
  return await requestData<ModelingRun>(
    `/modeling-pipelines/${pipelineId}:run`,
    onPlatform({
      method: 'POST',
      body: { trigger, is_keeping_frames: isKeepingFrames },
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

/**
 * 某个端口那份全量结果的下载地址。
 *
 * ⚠ 只给地址不给字节：一份 CSV 可以到几十 MB，走 `fetch` 拉回内存再造 blob
 * 是白付一遍内存；交给浏览器直接下更省，也天然带进度。
 * ⚠ 这条要 `modeling:view` **且** `dataset:record:export`——那份 CSV 里是台账
 * 原始数据（docs/MODELING_PLATFORM_DESIGN.md D12）。
 */
export function modelingFrameUrl(
  runId: string,
  nodeId: string,
  port: string,
): string {
  const query = new URLSearchParams({ port })
  return `${PLATFORM_BASE_URL}/modeling-runs/${runId}/frames/${nodeId}?${query.toString()}`
}

/**
 * 一页运行记录。给流水线 id 就只看这一条流水线的；给 `null` 就是全部。
 *
 * ⚠ 跨流水线那一档不是「顺手加的」：一次训练跑在 worker 上，用户离开画布之后
 * 就再也找不到它了——运行面存在的理由就是这个。
 */
export async function listModelingRuns(
  pipelineId: string | null,
  query: ModelingPageQuery = {},
): Promise<Page<ModelingRunSummary>> {
  return await requestData<Page<ModelingRunSummary>>(
    '/modeling-runs',
    onPlatform({
      query: {
        ...(pipelineId === null ? {} : { pipeline_id: pipelineId }),
        page: query.page,
        size: query.size,
      },
    }),
  )
}

/**
 * 一次运行的详情：状态、节点清单，外加**当时那份图**。
 * @param signal 轮询用；换页或离开时要能取消
 */
export async function getModelingRun(
  runId: string,
  signal?: AbortSignal,
): Promise<ModelingRun> {
  return await requestData<ModelingRun>(
    `/modeling-runs/${runId}`,
    onPlatform(signal === undefined ? {} : { signal }),
  )
}

/** 单个节点的结果摘要。按需拉，**不随轮询一起拉**。 */
export async function getModelingNodeRun(
  runId: string,
  nodeId: string,
): Promise<ModelingNodeRun> {
  return await requestData<ModelingNodeRun>(
    `/modeling-runs/${runId}/nodes/${nodeId}`,
    onPlatform(),
  )
}

/** 请求取消。回执是「已受理」，真正停下来要等当前这一步跑完。 */
export async function cancelModelingRun(runId: string): Promise<ModelingRun> {
  return await requestData<ModelingRun>(
    `/modeling-runs/${runId}:cancel`,
    onPlatform({ method: 'POST', headers: idempotent(newIdempotencyKey()) }),
  )
}

/** 一页模型版本。给流水线 id 就只看这一条流水线产出的。 */
export async function listModelingVersions(
  query: ModelingPageQuery & { pipelineId?: string | undefined } = {},
): Promise<Page<ModelingVersionSummary>> {
  return await requestData<Page<ModelingVersionSummary>>(
    '/modeling-model-versions',
    onPlatform({
      query: {
        pipeline_id: query.pipelineId,
        page: query.page,
        size: query.size,
      },
    }),
  )
}

/** 把一次成功的运行发布成一个模型版本。版本号由后端递增。 */
export async function publishModelingVersion(input: {
  run_id: string
  name: string
  description?: string | null | undefined
}): Promise<ModelingVersion> {
  return await requestData<ModelingVersion>(
    '/modeling-model-versions',
    onPlatform({
      method: 'POST',
      body: input,
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

export async function getModelingVersion(
  versionId: string,
): Promise<ModelingVersion> {
  return await requestData<ModelingVersion>(
    `/modeling-model-versions/${versionId}`,
    onPlatform(),
  )
}

/** 下线一个版本。绑在它上面的公式会开始报「模型不可用」。 */
export async function retireModelingVersion(
  versionId: string,
): Promise<ModelingVersion> {
  return await requestData<ModelingVersion>(
    `/modeling-model-versions/${versionId}:retire`,
    onPlatform({ method: 'POST', headers: idempotent(newIdempotencyKey()) }),
  )
}

/** 全部公式绑定。`is_orphaned` 是每次列表时现算的。 */
export async function listModelingBindings(
  query: ModelingPageQuery = {},
): Promise<Page<ModelingBinding>> {
  return await requestData<Page<ModelingBinding>>(
    '/modeling-bindings',
    onPlatform({ query: { page: query.page, size: query.size } }),
  )
}

/** 把一个版本绑到一条公式条目上。回执带受影响的台账列。 */
export async function createModelingBinding(input: {
  fx_code: string
  model_version_id: string
}): Promise<ModelingBindingImpact> {
  return await requestData<ModelingBindingImpact>(
    '/modeling-bindings',
    onPlatform({
      method: 'POST',
      body: input,
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

/** 换版本或启停。回执同样带受影响的台账列。 */
export async function updateModelingBinding(
  bindingId: string,
  input: {
    model_version_id?: string | undefined
    is_enabled?: boolean | undefined
  },
): Promise<ModelingBindingImpact> {
  return await requestData<ModelingBindingImpact>(
    `/modeling-bindings/${bindingId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

export async function deleteModelingBinding(bindingId: string): Promise<void> {
  await request<null>(
    `/modeling-bindings/${bindingId}`,
    onPlatform({ method: 'DELETE', headers: idempotent(newIdempotencyKey()) }),
  )
}

/**
 * 一键把一个版本注册成库公式并绑上。
 *
 * ⚠ 要**同时**有 `modeling:publish` 与 `dataset:manage`：绝不能让发布权顺带
 * 获得往公式库写的能力。没有后者时按钮要禁用并说明原因。
 */
export async function registerModelingFormula(
  versionId: string,
  fxCode: string,
): Promise<ModelFormulaRegistration> {
  return await requestData<ModelFormulaRegistration>(
    `/modeling-model-versions/${versionId}:register-formula`,
    onPlatform({
      method: 'POST',
      body: { fx_code: fxCode },
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

/** 全部对外服务。 */
export async function listModelDeployments(): Promise<ModelDeployment[]> {
  return await requestData<ModelDeployment[]>(
    '/modeling-deployments',
    onPlatform(),
  )
}

/** 把一个模型版本开成第三方可调的服务。 */
export async function createModelDeployment(input: {
  code: string
  model_version_id: string
  name: string
  description?: string | undefined
  max_rows_per_call?: number | undefined
  rate_limit_per_minute?: number | undefined
}): Promise<ModelDeployment> {
  return await requestData<ModelDeployment>(
    '/modeling-deployments',
    onPlatform({
      method: 'POST',
      body: input,
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

/** 换版本、改配额、启停。`code` 不可改——第三方的代码里写着它。 */
export async function updateModelDeployment(
  deploymentId: string,
  input: {
    name?: string | undefined
    description?: string | undefined
    model_version_id?: string | undefined
    is_enabled?: boolean | undefined
    max_rows_per_call?: number | undefined
    rate_limit_per_minute?: number | undefined
  },
): Promise<ModelDeployment> {
  return await requestData<ModelDeployment>(
    `/modeling-deployments/${deploymentId}`,
    onPlatform({ method: 'PATCH', body: input }),
  )
}

export async function deleteModelDeployment(
  deploymentId: string,
): Promise<void> {
  await request<null>(
    `/modeling-deployments/${deploymentId}`,
    onPlatform({ method: 'DELETE', headers: idempotent(newIdempotencyKey()) }),
  )
}

/** 一个服务下的全部密钥。⚠ 回执里没有明文。 */
export async function listModelApiKeys(
  deploymentId: string,
): Promise<ModelApiKey[]> {
  return await requestData<ModelApiKey[]>(
    `/modeling-deployments/${deploymentId}/api-keys`,
    onPlatform(),
  )
}

/**
 * 铸一把新钥匙。
 *
 * ⚠ 回执里的 `plaintext` 是**唯一**一次拿得到明文的机会，之后任何接口都取不
 * 回来。界面上必须当场说清楚并给「复制」。
 */
export async function createModelApiKey(
  deploymentId: string,
  input: { name: string; expires_at?: string | undefined },
): Promise<ModelApiKeyMinted> {
  return await requestData<ModelApiKeyMinted>(
    `/modeling-deployments/${deploymentId}/api-keys`,
    onPlatform({
      method: 'POST',
      body: input,
      headers: idempotent(newIdempotencyKey()),
    }),
  )
}

/** 撤销一把钥匙。立刻生效。 */
export async function revokeModelApiKey(
  deploymentId: string,
  keyId: string,
): Promise<ModelApiKey> {
  return await requestData<ModelApiKey>(
    `/modeling-deployments/${deploymentId}/api-keys/${keyId}:revoke`,
    onPlatform({ method: 'POST', headers: idempotent(newIdempotencyKey()) }),
  )
}

/** 近一个月按天的调用量与出错量。 */
export async function listModelCallStats(
  deploymentId: string,
): Promise<ModelCallStat[]> {
  return await requestData<ModelCallStat[]>(
    `/modeling-deployments/${deploymentId}/call-stats`,
    onPlatform(),
  )
}
