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
