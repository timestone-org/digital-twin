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
export const KNOWLEDGE_SOURCE_KINDS = ['upload', 'dataset'] as const

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
  strategies: string[]
  ready_strategies: string[]
  source_kinds: string[]
  /**
   * 界面 file input 的 accept 名单。
   * ⚠ 由后端的解析器注册表算出来下发，前端**不写死一份**：两份漂开的表现是
   * 「选得中的文件传上去被拒」，而两边单看都对。
   */
  accepted_suffixes: string[]
  index: KnowledgeIndexCapability
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
