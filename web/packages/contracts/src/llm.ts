/**
 * @fileoverview 模型供应商目录的对外类型，逐字段对齐 platform-server 的
 * openapi.json 里 `llm-providers` / `llm-purposes` 一族（ADR-0039）。
 *
 * ⚠ 字段名保持后端的 snake_case（与助手那组同源）：这一层是线形，
 * 换成驼峰就要多一份映射，而映射写错时 typecheck 与 lint 双双放行。
 * ⚠ 每个出参类型都被 `app/tests/contract/llm-shapes.contract.spec.ts`
 * 钉在 openapi 上；用途码与模型种类还对着三个服务的源码逐字比。
 */

/** 一路供应商上登记的模型种类。嵌入模型与对话模型不通用。 */
export const LLM_MODEL_KINDS = ['chat', 'embedding'] as const
export type LlmModelKind = (typeof LLM_MODEL_KINDS)[number]

/** 用途属于哪个消费方，界面按它分组。 */
export const LLM_CONSUMERS = ['assistant', 'knowledge'] as const
export type LlmConsumer = (typeof LLM_CONSUMERS)[number]

/**
 * 全部用途码。⚠ 与 platform-server `apps/llm_providers/enums.py`、助手的
 * `llm/ports.py`、知识库的 `llm_purposes.py` 三处逐字一致；漂开的表现是
 * 「界面上分配了、那一侧却还在用环境变量那一档」。
 */
export const LLM_PURPOSES = [
  'assistant.chat',
  'assistant.vision',
  'assistant.summary',
  'assistant.embedding',
  'knowledge.chat',
  'knowledge.embedding',
] as const
export type LlmPurposeCode = (typeof LLM_PURPOSES)[number]

/** 一路供应商上登记的一个模型。 */
export interface LlmModel {
  name: string
  kind: string
  has_vision: boolean
  /** 嵌入模型的向量维数；对话模型是 null。 */
  dimensions: number | null
}

/** 一路供应商。密钥只露尾巴几位。 */
export interface LlmProvider {
  id: string
  name: string
  base_url: string
  /** 密钥尾巴，形如 `…a1b2`。只回答「填的是不是那一把」。 */
  api_key_hint: string
  is_enabled: boolean
  /** 透传给端点的额外请求体（思考开关一类）；没配是 null。 */
  extra_body: Record<string, unknown> | null
  models: LlmModel[]
  notes: string
  /** 此刻指着这一路的用途码；删之前界面要把它们摆出来。 */
  assigned_purposes: string[]
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** 探一次端点的结果。 */
export interface LlmProbeResult {
  is_ok: boolean
  /** 给人看的一句话；失败时是原因，不含端点地址与密钥。 */
  message: string
  /** 端点自报的模型代号，界面拿它做「一键登记」。 */
  model_names: string[]
}

/** 一个用途，以及它此刻指向哪里。没分配时后四格都是 null。 */
export interface LlmPurpose {
  purpose: string
  label: string
  description: string
  kind: string
  consumer: string
  is_vision_required: boolean
  provider_id: string | null
  provider_name: string | null
  model_name: string | null
  updated_at: string | null
}
