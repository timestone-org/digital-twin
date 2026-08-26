/**
 * @fileoverview AI 助手的对外类型，与 ai-assistant 的 openapi.json 逐字段对齐。
 *
 * ⚠ 字段名保持后端的 snake_case（与采集那组同源）：这一层是线形，
 * 换成驼峰就要多一份映射，而映射写错时 typecheck 与 lint 双双放行。
 */

/** 助手所处的页面。与后端的闭合集合逐字一致，未登记的值后端一律 400。 */
export const ASSISTANT_SURFACE_KINDS = [
  'dashboard-editor',
  'twin-editor',
  'dataset-table',
  'collect-source',
  'dashboard-view',
] as const

export type AssistantSurfaceKind = (typeof ASSISTANT_SURFACE_KINDS)[number]

/** 一个技能在清单上的样子。指令正文不出后端那道门，所以这里没有它。 */
export interface AssistantSkill {
  name: string
  title: string
  /** 一句话简介。它同时是模型选技能时看到的那一句。 */
  summary: string
  surface_kinds: string[]
  /** 用它需要的权限码。前端据它决定摆不摆入口。 */
  required_codes: string[]
}

/** 能选的一路模型。 */
export interface AssistantModelProfile {
  id: string
  label: string
  /**
   * 这一路此刻能不能用。
   * ⚠ 「配了」不等于「能用」：订阅账号那一路还得先登录过。为假时要把它灰着
   * 并指向系统页——摆成可选的话，用户点下去收到的是一条「模型暂时不可用」。
   */
  is_ready: boolean
  has_vision: boolean
  models: string[]
  /** 可调的推理档位；空表示这一路没有这一档。 */
  efforts: string[]
}

/**
 * 助手能力。
 *
 * ⚠ **取不到这份 = 助手不存在**，不是「暂时故障」：某些现场根本不部署
 * ai-assistant，那时边缘直接 502，入口就该干净地不出现，而不是弹一条红色告警。
 */
export interface AssistantCapability {
  /** 模型端点是否配好并开着。关着时会话仍可读，但发不出新回合。 */
  is_model_enabled: boolean
  /** 视觉输入是否可用。看截图提建议那类技能据它决定摆不摆。 */
  is_vision_enabled: boolean
  skills: AssistantSkill[]
  /** 这套部署接了哪几路模型。空 = 一路都没接。 */
  models: AssistantModelProfile[]
  /** 没选过时用哪一路。 */
  default_model_id: string
}

/** 一路模型账号的登录态。⚠ 令牌本身**永远不在里面**。 */
export interface AssistantCredentialStatus {
  provider: string
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
export interface AssistantDeviceLoginStart {
  /** 这次登录的句柄。⚠ 不是 device_code——那一格是密钥态，不下发。 */
  ref: string
  user_code: string
  verification_uri: string
  /** 建议的轮询间隔。⚠ 必须照它来：打快了上游会限流整台机器。 */
  interval_s: number
  expires_in_s: number
}

/** 问了一次的结果。 */
export interface AssistantDeviceLoginPoll {
  is_done: boolean
  /** 下一次隔多久再问。上游让慢下来时这个数会变大，界面要用回它。 */
  interval_s: number
  status: AssistantCredentialStatus | null
}

/** 消息的说话人。`tool` 是工具结果回填的那一条。 */
export const ASSISTANT_MESSAGE_ROLES = ['user', 'assistant', 'tool'] as const

export type AssistantMessageRole = (typeof ASSISTANT_MESSAGE_ROLES)[number]

/** 步骤的种类。服务端与客户端工具分两档，因为失败含义完全不同。 */
export const ASSISTANT_STEP_KINDS = [
  'model',
  'server_tool',
  'client_tool',
] as const

export type AssistantStepKind = (typeof ASSISTANT_STEP_KINDS)[number]

/**
 * 步骤的状态。
 *
 * ⚠ `awaiting_client` 是待续状态：模型已经要了客户端工具，正等浏览器把结果
 * 送回来。界面上它是「转着圈的那一行」，不是失败。
 */
export const ASSISTANT_STEP_STATES = [
  'running',
  'awaiting_client',
  'succeeded',
  'failed',
  'aborted',
] as const

export type AssistantStepState = (typeof ASSISTANT_STEP_STATES)[number]

/** 一个步骤 —— 界面上「AI 做了什么」逐条渲染的就是它。 */
export interface AssistantStep {
  id: string
  message_id: string
  seq: number
  kind: string
  name: string
  state: string
  input_json: Record<string, unknown> | null
  output_json: Record<string, unknown> | null
  error: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
}

/** 一条消息。`content_json` 的形状随 role 变，前端按 role 分支读。 */
export interface AssistantMessage {
  id: string
  session_id: string
  seq: number
  role: string
  content_json: Record<string, unknown>
  usage_json: Record<string, unknown> | null
  steps: AssistantStep[]
  created_at: string
}

/** 会话列表里的一行。 */
export interface AssistantSession {
  id: string
  user_id: string
  title: string
  surface_kind: string
  surface_ref: string | null
  is_archived: boolean
  /** 乐观锁行版本。改标题与归档都推进它。 */
  row_version: number
  /** 最近一次失败的原因，给人看。不带上游地址与密钥。 */
  last_error: string | null
  /** 这个会话选了哪一路模型、哪一档；`null` = 按部署配置的默认。 */
  model_profile: string | null
  reasoning_effort: string | null
  created_at: string
  updated_at: string
}

/** 会话详情：列表那一行加上全部消息与步骤。 */
export interface AssistantSessionDetail extends AssistantSession {
  messages: AssistantMessage[]
  /** 当前执行计划（ADR-0024）；没有就是 null。重开面板时靠它恢复清单。 */
  plan_json: AssistantPlan | null
}

/**
 * 事件流的事件名。
 *
 * ⚠ **这一组不在 openapi 里**：SSE 的载荷 openapi 描述不了，所以它是一份
 * 「没有生成物兜底」的契约。两侧靠一条契约用例对着后端的 `events.py` 比对——
 * 漂开的表现是「助手做了一步但界面上没有」，而两边代码单看都对。
 */
export const ASSISTANT_EVENT_NAMES = [
  'message.delta',
  'step',
  'client_tool.request',
  'turn.done',
  'error',
  'plan',
] as const

export type AssistantEventName = (typeof ASSISTANT_EVENT_NAMES)[number]

/**
 * 计划项的状态。⚠ 闭合集合，与后端 `services/plan.py` 逐字一致：
 * 认不出的状态前端按 `pending` 画，不静默丢整项。
 */
export const ASSISTANT_PLAN_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'skipped',
  'failed',
] as const

export type AssistantPlanStatus = (typeof ASSISTANT_PLAN_STATUSES)[number]

/** 计划里的一项。 */
export interface AssistantPlanItem {
  title: string
  status: AssistantPlanStatus
  /** 补充说明或失败原因；空串表示没有。 */
  note: string
}

/**
 * 一份执行计划（ADR-0024）。`plan` 事件整份下发，前端不做增量合并；
 * 全部项走完后 `state` 变成 `done`。
 */
export interface AssistantPlan {
  title: string
  state: 'active' | 'done'
  items: AssistantPlanItem[]
}

/**
 * 模型逐字吐出来的一小块走哪一路。
 *
 * ⚠ 两路分开而不是拼成一路：`reasoning` 动辄比 `text` 长几倍，混进正文的话，
 * 用户看到的是一大段自言自语后面跟着结论，而他要读的只有结论。
 * ⚠ `reasoning` **只活在这一轮**：它不落库，重开会话时看不到。
 */
export const ASSISTANT_DELTA_CHANNELS = ['text', 'reasoning'] as const

export type AssistantDeltaChannel = (typeof ASSISTANT_DELTA_CHANNELS)[number]

/** 要交给浏览器执行的一次调用。 */
export interface AssistantToolCall {
  /** 模型给的调用 id。⚠ 回填结果时必须逐字用它。 */
  call_id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * 读出来的一份参考文件：表格有 columns/rows，纯文本两者为空、正文只在 text。
 *
 * ⚠ 服务端**不存文件**：读完就把内容交出来，由前端附在用户那句话后面——
 * 用户看得见助手将要看到什么，这一点比省几行界面重要。
 */
export interface AssistantParsedTable {
  columns: string[]
  rows: string[][]
  /** 内容超上限时截断了。⚠ 截断了要在界面上说出来。 */
  is_truncated: boolean
  /** 截断前的总行数。 */
  total_rows: number
  /** 摊平给模型看的那一段：表格是竖线分隔，纯文本是原文（含截断说明）。 */
  text: string
}
