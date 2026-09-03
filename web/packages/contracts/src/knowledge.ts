/**
 * @fileoverview 知识库的对外类型，与 knowledge-server 的 openapi.json 逐字段对齐。
 *
 * ⚠ 字段名保持后端的 snake_case（与助手、采集那两组同源）：这一层是线形，
 * 换成驼峰就要多一份映射，而映射写错时 typecheck 与 lint 双双放行。
 */

/** 检索策略。与后端注册表的名字逐字一致，未登记的值后端一律 400。 */
export const KNOWLEDGE_STRATEGIES = ['naive', 'hybrid', 'agentic'] as const

export type KnowledgeStrategy = (typeof KNOWLEDGE_STRATEGIES)[number]

/** 知识来源的种类。文件上传只是其中一路。 */
export const KNOWLEDGE_SOURCE_KINDS = ['upload', 'platform'] as const

export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number]

/** 一份文档在摄取管线上走到哪了。 */
export const KNOWLEDGE_DOCUMENT_STATUSES = [
  'pending',
  'parsing',
  'chunking',
  'embedding',
  'indexing',
  'ready',
  'failed',
] as const

export type KnowledgeDocumentStatus =
  (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number]

/** 向量那一路实际走在哪一档上。 */
export const KNOWLEDGE_VECTOR_LANES = ['pgvector', 'bruteforce'] as const

export type KnowledgeVectorLane = (typeof KNOWLEDGE_VECTOR_LANES)[number]

/** 关键词那一路实际走在哪一档上。 */
export const KNOWLEDGE_KEYWORD_LANES = ['trgm', 'like'] as const

export type KnowledgeKeywordLane = (typeof KNOWLEDGE_KEYWORD_LANES)[number]

/**
 * 两路索引各自走在哪一档上。
 *
 * ⚠ `reason` 不是装饰：走在回退档上时界面要把它显示出来。悄悄退化的表现是
 * 「有点慢」「有点不准」，而没有人会去查一件没人说过的事。
 */
export interface KnowledgeIndexCapability {
  vector: string
  keyword: string
  /** 走在回退档上的原因；走在首选档上时是空串。 */
  reason: string
}

/**
 * 解析那一层此刻装了哪几路后端。
 *
 * ⚠ 外部那一路（MinerU / PP-Structure 这一类）**没接就是空表**：占位的表现是
 * 「界面上写着接了，传上去却报一句谁也看不懂的错」，所以缺席要连着 `reason`
 * 一起如实报出来。
 */
export interface KnowledgeParsingCapability {
  /** 本地库解那一路装了哪几个，按注册序。 */
  local_backends: string[]
  /** 外部解析服务那一路此刻接了哪几个。 */
  external_backends: string[]
  /** 外部那一路缺席的原因；接上了是空串。 */
  reason: string
}

/**
 * 重排那一路此刻接没接（ADR-0042）。
 *
 * ⚠ `reason` 不是装饰：没接时检索走的是融合名次那一档，而悄悄退化的表现正是
 * 「质量忽然变了、一处都不报错」。这一格就是那句话。
 * ⚠ 换重排模型**不作废任何存量向量**：界面上别把它说成「换了要重建」。
 */
export interface KnowledgeRerankCapability {
  is_enabled: boolean
  /** 此刻用的重排模型名；没接时是空串。 */
  model: string
  /** 没接时说得出为什么；接上了是空串。 */
  reason: string
}

/** 这套部署的知识库此刻能干什么。 */
export interface KnowledgeCapability {
  /**
   * 嵌入档接上了吗。
   * ⚠ 为假时检索**如实回答「这个库还没建索引」**，不是返回空表——
   * 空表与「确实没有相关内容」长得一模一样。
   */
  is_embedding_enabled: boolean
  /** 对话档接上了吗。它只决定 `agentic` 策略可不可用。 */
  is_model_enabled: boolean
  /** 语音输入接上了吗：自建 FunASR 经 knowledge-server 中继（ADR-0038）。 */
  is_asr_enabled: boolean
  strategies: string[]
  ready_strategies: string[]
  source_kinds: string[]
  /**
   * 界面 file input 的 accept 名单。
   * ⚠ 由后端的解析器注册表算出来下发，前端**不写死一份**：两份漂开的表现是
   * 「选得中的文件传上去被拒」，而两边单看都对。
   */
  accepted_suffixes: string[]
  parsing: KnowledgeParsingCapability
  index: KnowledgeIndexCapability
  rerank: KnowledgeRerankCapability
}

/** 一个知识库。 */
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  retrieval_strategy: string
  /**
   * 算这个库全部向量的那一路与维数。
   * ⚠ 没接嵌入时都是 null——那时检索**如实回答「这个库还没建索引」**，
   * 不是返回空表：空表与「确实没有相关内容」长得一模一样。
   */
  embedding_model: string | null
  dimensions: number | null
  owner_id: string
  document_count: number
  created_at: string
  updated_at: string
}

/** 一个库下的一路来源。文件上传只是其中一路。 */
export interface KnowledgeSource {
  id: string
  base_id: string
  kind: string
  name: string
  config: Record<string, unknown>
  last_synced_at: string | null
  /**
   * 上一次同步失败的原因。
   * ⚠ 留着而不是清掉：清掉的话界面上是「从没同步过」，而那与「同步了但一直
   * 失败」是两件事。
   */
  last_error: string
  created_at: string
}

/** 一份文档。 */
export interface KnowledgeDocument {
  id: string
  base_id: string
  source_id: string
  title: string
  media_type: string
  byte_size: number
  /** 摄取状态机走到哪了。闭合集合，与数据库 CHECK 同源。 */
  status: string
  /**
   * 失败原因，一句人话。
   * ⚠ 它会原样上界面，所以后端保证里面不含表名、SQL 与内网地址。
   */
  failure_reason: string
  chunk_count: number
  created_at: string
  ready_at: string | null
}

/**
 * 一张把键、类型与大小都钉死的直传表单。
 *
 * ⚠ `fields` 必须**原样按序**写进 multipart 表单，且文件字段排在最后：
 * S3 的 POST 语义是「文件之后的字段一律忽略」，把 key 或签名排到文件后面，
 * 存储端读到的是一份缺字段的表单，报出来的是含糊的 403。
 */
export interface KnowledgeUploadTicket {
  document_id: string
  url: string
  fields: Record<string, string>
  object_key: string
  expires_seconds: number
}

/**
 * 一条召回在原件里的位置。
 *
 * ⚠ 各格按格式各取所需：pdf 与 pptx 用 `page`，xlsx 用 `sheet` + `row`，
 * md 与 docx 用 `path`。硬凑一个统一的「行号」会让「第 3 行」在不同格式里
 * 指着完全不同的东西。
 */
export interface KnowledgeLocator {
  page: number | null
  sheet: string
  row: number | null
  path: string[]
  /** 给人看的一句位置。⚠ 由后端拼：各端各拼一份一定会漂。 */
  label: string
}

/** 一条召回，自带够用来核对的出处。 */
export interface KnowledgeHit {
  /** ⚠ 引用指到**块**不指到文档：指到文档等于没给出处。 */
  chunk_id: string
  document_id: string
  document_title: string
  text: string
  heading_path: string
  locator: KnowledgeLocator
  score: number
  /** 它凭什么排在这。选哪一条由用户定，因为只有用户知道自己这句话的上下文。 */
  why: string
}

/** 一次检索的结果。 */
export interface KnowledgeSearchResult {
  hits: KnowledgeHit[]
  strategy: string
  rounds: number
  /** 到顶了没查全吗。⚠ 界面要如实显示，不许装作查完了。 */
  is_complete: boolean
  /**
   * 给人看的一句说明。
   * ⚠ 「这套部署没接嵌入档，本次只走了关键词那一路」这类话走这里，
   * **不走空表**：空表与「确实没有相关内容」长得一模一样。
   */
  note: string
}

/** 一次问答的结果。 */
export interface KnowledgeAnswer {
  /** 合成好的答案。每句结论后面挂着角标，角标对应 `citations` 的序号。 */
  answer: string
  /**
   * 答案依据的那几段。
   * ⚠ **顺序即角标**：界面按数组下标 + 1 渲染角标，重排一次引用就全指错了，
   * 而看着完全正常。
   */
  citations: KnowledgeHit[]
  strategy: string
  rounds: number
  /** 到顶了没查全吗。⚠ 界面要如实显示，不许装作查完了。 */
  is_complete: boolean
  note: string
}

/** 跑一次来源同步的结果。 */
export interface KnowledgeSyncResult {
  registered: number
  /**
   * 内容重复而跳过的条数。
   * ⚠ 与「登记了 0 条」分开显示：前者是「没有新东西」，后者可能是路径配错了。
   */
  skipped: number
  /**
   * 到了页数上限还没拉完吗。
   * ⚠ 界面要如实提示「还有更多，再按一次」——装作拉完了的话，用户不会再按，
   * 而剩下的记录永远进不来。
   */
  has_more: boolean
}

/**
 * 知识库对话（docs/KNOWLEDGE_CHAT_DESIGN.md）。
 *
 * ⚠ 步骤、消息两个形状与助手那边**逐字相同**（`AssistantStep` /
 * `AssistantMessage`）：渲染它们的组件两边共用，多一格少一格界面就画不出来。
 * 后端有一条契约测试钉住三个闭合集合；这里由 `knowledge-shapes` 契约钉字段。
 */

/** 对话回合里的一步：一次模型调用或一次工具执行。 */
export interface KnowledgeChatStep {
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

/** 对话里的一条消息。`content_json` 的形状随 role 变，前端按 role 分支读。 */
export interface KnowledgeChatMessage {
  id: string
  session_id: string
  seq: number
  role: string
  content_json: Record<string, unknown>
  usage_json: Record<string, unknown> | null
  steps: KnowledgeChatStep[]
  created_at: string
}

/** 对话列表里的一行。⚠ 没有 `base_id`：对话是跨库的，模型自己决定去哪个库找。 */
export interface KnowledgeChatSession {
  id: string
  user_id: string
  title: string
  is_archived: boolean
  /** 乐观锁行版本。改标题与归档都推进它。 */
  row_version: number
  /** 最近一次失败的原因，给人看。不带上游地址与密钥。 */
  last_error: string | null
  created_at: string
  updated_at: string
}

/** 对话详情：列表那一行加上全部消息与步骤。 */
export interface KnowledgeChatSessionDetail extends KnowledgeChatSession {
  messages: KnowledgeChatMessage[]
}

/** 浏览器跑完反问之后带回来的东西。`call_id` 必须是模型给的那个逐字原样。 */
export interface KnowledgeChatToolResult {
  call_id: string
  output?: unknown
  error?: string | null
}

/**
 * 推进一个回合。⚠ `user_text` 与 `tool_results` 二选一，且必须有一个。
 * `client_tools` 是这一页实现了哪些客户端工具——对话页只会报 `user.ask`。
 */
export interface KnowledgeChatAdvanceIn {
  user_text?: string | null
  tool_results?: KnowledgeChatToolResult[]
  client_tools?: string[]
}

/** 这套部署没接对话档（领域 23）。⚠ 按码分支，不按 message。 */
export const KNOWLEDGE_CHAT_UNAVAILABLE_CODE = 42321
