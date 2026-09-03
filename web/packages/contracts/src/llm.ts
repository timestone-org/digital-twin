/**
 * @fileoverview 模型供应商目录的对外类型，逐字段对齐 platform-server 的
 * openapi.json 里 `llm-providers` / `llm-purposes` 一族（ADR-0039）。
 *
 * ⚠ 字段名保持后端的 snake_case（与助手那组同源）：这一层是线形，
 * 换成驼峰就要多一份映射，而映射写错时 typecheck 与 lint 双双放行。
 * ⚠ 每个出参类型都被 `app/tests/contract/llm-shapes.contract.spec.ts`
 * 钉在 openapi 上；用途码与模型种类还对着三个服务的源码逐字比。
 */

/**
 * 一路供应商上登记的模型种类。三种互不通用：拿对话模型名去打 embeddings
 * 端点、或拿嵌入模型去做重排，都是必然失败的调用。
 */
export const LLM_MODEL_KINDS = ['chat', 'embedding', 'rerank'] as const
export type LlmModelKind = (typeof LLM_MODEL_KINDS)[number]

/**
 * 重排的线形方言（ADR-0042）。重排不在 OpenAI 兼容口径里，各家的路径与请求体
 * 不同。⚠ 与 platform-server `apps/llm_providers/enums.py` 和 llmcore 的
 * `rerank/registry.py` 逐字一致；漂开的表现是「界面上选得中、调用时说不认识」。
 */
export const LLM_RERANK_DIALECTS = ['jina', 'dashscope'] as const
export type LlmRerankDialectCode = (typeof LLM_RERANK_DIALECTS)[number]

/**
 * 一路供应商的接入形态。⚠ 与 platform-server `apps/llm_providers/enums.py`
 * 和助手的 `llm/ports.py` 逐字一致；漂开的表现是「界面上配好了一路 Codex、
 * 助手却当它不存在」，而两边代码单看都对。
 */
export const LLM_PROVIDER_KINDS = ['openai_compat', 'codex_oauth'] as const
export type LlmProviderKindCode = (typeof LLM_PROVIDER_KINDS)[number]

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
  'knowledge.rerank',
] as const
export type LlmPurposeCode = (typeof LLM_PURPOSES)[number]

/** 一套重排线形：打端点根下的哪个路径、请求体长什么样。 */
export interface LlmRerankDialect {
  code: string
  label: string
  description: string
}

/** 建一路供应商时能一键填上的一套取值。 */
export interface LlmProviderPreset {
  code: string
  label: string
  base_url: string
}

/**
 * 一种接入形态：界面按它决定摆哪几格、后端按同一份校验。
 * ⚠ 由后端下发而不是前端写死：两份漂开的表现是「表单里填了、保存时 422」，
 * 而那句话指不回是哪一格多余。
 */
export interface LlmProviderKind {
  code: string
  label: string
  description: string
  /** 要不要填端点与密钥。为假的那些形态靠登录拿令牌。 */
  is_endpoint_required: boolean
  /** 要不要先走一次登录（设备码）。 */
  is_login_required: boolean
  /** 这一形态登记得了哪几种模型。 */
  model_kinds: string[]
  /** 哪几个消费方接得了它。 */
  consumers: string[]
  /** 可调的推理档位；空表示这一形态没有这一档。 */
  efforts: string[]
  /**
   * 这一形态配得出哪几套重排线形；空表示它登记不了重排模型。
   * ⚠ 第一个是默认那一路：没配这一格的供应商按它解。
   */
  rerank_dialects: LlmRerankDialect[]
  presets: LlmProviderPreset[]
}

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
  /** 接入形态。建了就不许改——改形态等于换一路接法。 */
  kind: string
  /** 靠登录的那些形态没有端点，这一格是空串。 */
  base_url: string
  /** 密钥尾巴，形如 `…a1b2`。只回答「填的是不是那一把」。 */
  api_key_hint: string
  is_enabled: boolean
  /** 透传给端点的额外请求体（思考开关一类）；没配是 null。 */
  extra_body: Record<string, unknown> | null
  /** 这一形态自己的那几格配置（推理档位一类）；没配是 null。 */
  options: Record<string, unknown> | null
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
  /**
   * 没分配时那一侧还有没有环境变量那一档兜底。
   * ⚠ 为假即「不分配就是不启用」：说反了的话，人会去翻一个不存在的环境变量。
   */
  has_env_default: boolean
  provider_id: string | null
  provider_name: string | null
  model_name: string | null
  updated_at: string | null
}

/**
 * 一路供应商的登录态（ADR-0041：登录态归 platform，与那一行同属主）。
 * ⚠ 令牌本身**永远不在里面**——出去过一次就永远躺在别人的 devtools 里。
 */
export interface LlmCredential {
  provider_id: string
  is_connected: boolean
  /** 账号标识的掩码，形如 `…a1b2c3`。只回答「是不是我那个号」。 */
  account_label: string | null
  plan_label: string | null
  expires_at: string | null
  last_refresh_at: string | null
  /** 最近一次续期失败的原因，给人看。为空表示一切正常。 */
  last_error: string | null
}

/** 设备码登录开了个头。 */
export interface LlmDeviceLoginStart {
  /** 这次登录的句柄。⚠ 不是 device_auth_id——那一格是密钥态，不下发。 */
  ref: string
  user_code: string
  verification_uri: string
  /** 建议的轮询间隔。⚠ 必须照它来：打快了上游会限流整台机器。 */
  interval_s: number
  expires_in_s: number
}

/** 问了一次的结果。 */
export interface LlmDeviceLoginPoll {
  is_done: boolean
  /** 下一次隔多久再问。上游让慢下来时这个数会变大，界面要用回它。 */
  interval_s: number
  credential: LlmCredential | null
}
