/**
 * @fileoverview 知识库出参的线形（后端 snake_case）与它到载荷（camelCase）的映射。
 *
 * ⚠ 逐字段窄化，不写 `as`：后端与前端各改各的时，断言会让错形状一路流进界面，
 * 最后崩在某个深层组件里，而不是在这里说「形状不对」。
 */
import type { KnowledgeDocumentStatus, KnowledgeStrategy } from '@dt/contracts'
import {
  KNOWLEDGE_DOCUMENT_STATUSES,
  KNOWLEDGE_STRATEGIES,
} from '@dt/contracts'

import { TransportError } from './client'

/** 一个知识库。 */
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  strategy: KnowledgeStrategy
  /**
   * 算这个库全部向量的那一路与维数。
   * ⚠ 保留 null 而不是折成空串：null 是「这个库还没建索引」，
   * 而空串看起来像「模型名忘了填」。
   */
  embeddingModel: string | null
  dimensions: number | null
  documentCount: number
  createdAt: string
}

/** 一路来源。 */
export interface KnowledgeSource {
  id: string
  baseId: string
  kind: string
  name: string
  lastSyncedAt: string | null
  /** 上一次同步失败的原因；成功过就是空串。 */
  lastError: string
}

/** 一份文档。 */
export interface KnowledgeDocument {
  id: string
  title: string
  status: KnowledgeDocumentStatus
  /** 失败原因，一句人话；其余状态是空串。 */
  failureReason: string
  chunkCount: number
  sizeBytes: number
  createdAt: string
  readyAt: string | null
}

/** 一条召回。 */
export interface KnowledgeHit {
  chunkId: string
  documentTitle: string
  /** 给人看的一句位置（「1月 · 第 3 行」）。⚠ 由后端拼，前端不再拼一份。 */
  where: string
  headingPath: string
  text: string
  score: number
  why: string
}

/** 一次检索的结果。 */
export interface KnowledgeSearchResult {
  hits: KnowledgeHit[]
  strategy: string
  /** 「本次只走了关键词那一路」这类话。⚠ 空表 + 空 note 才是「确实没有」。 */
  note: string
}

/** 一次直传凭证。 */
export interface KnowledgeUploadTicket {
  documentId: string
  url: string
  /** ⚠ 必须原样按序写进表单，且**文件字段排在最后**。 */
  fields: Record<string, string>
  expiresSeconds: number
}

/** 两路索引各自走在哪一档上。 */
export interface KnowledgeIndexLanes {
  vector: string
  keyword: string
  /** 走在回退档上的原因；走在首选档上时是空串。 */
  reason: string
}

/** 这套部署此刻的知识库能力。 */
export interface KnowledgeCapability {
  isEmbeddingEnabled: boolean
  isModelEnabled: boolean
  /** 语音输入接上了吗。为假时对话页不放麦克风键。 */
  isAsrEnabled: boolean
  strategies: string[]
  readyStrategies: string[]
  acceptedSuffixes: string[]
  index: KnowledgeIndexLanes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function nullableCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((one) => one !== '') : []
}

/** 后端给的策略名收窄成闭合联合；不认识的一律拒。 */
function strategyOf(value: unknown): KnowledgeStrategy {
  const found = KNOWLEDGE_STRATEGIES.find((one) => one === value)
  if (found === undefined) {
    // ⚠ 不静默回落到某一种：回落的那一种会让界面显示的策略与实际跑的不是同
    // 一个，而两边都不报错
    throw new TransportError(0, `未知的检索策略：${text(value)}`)
  }
  return found
}

/** 文档状态同理收窄；不认识的当成待处理——至少不会显示成「已就绪」。 */
function statusOf(value: unknown): KnowledgeDocumentStatus {
  return KNOWLEDGE_DOCUMENT_STATUSES.find((one) => one === value) ?? 'pending'
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TransportError(0, `${what}的响应格式不对`)
  }
  return value
}

/** 线形 → 一个知识库。 */
export function toBase(value: unknown): KnowledgeBase {
  const row = record(value, '知识库')
  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
    strategy: strategyOf(row.retrieval_strategy),
    embeddingModel: nullableText(row.embedding_model),
    dimensions: nullableCount(row.dimensions),
    documentCount: count(row.document_count),
    createdAt: text(row.created_at),
  }
}

/** 线形 → 一路来源。 */
export function toSource(value: unknown): KnowledgeSource {
  const row = record(value, '来源')
  return {
    id: text(row.id),
    baseId: text(row.base_id),
    kind: text(row.kind),
    name: text(row.name),
    lastSyncedAt: nullableText(row.last_synced_at),
    lastError: text(row.last_error),
  }
}

/** 线形 → 一份文档。 */
export function toDocument(value: unknown): KnowledgeDocument {
  const row = record(value, '文档')
  return {
    id: text(row.id),
    title: text(row.title),
    status: statusOf(row.status),
    failureReason: text(row.failure_reason),
    chunkCount: count(row.chunk_count),
    sizeBytes: count(row.byte_size),
    createdAt: text(row.created_at),
    readyAt: nullableText(row.ready_at),
  }
}

function toHit(value: unknown): KnowledgeHit {
  const row = record(value, '召回')
  const locator = isRecord(row.locator) ? row.locator : {}
  return {
    chunkId: text(row.chunk_id),
    documentTitle: text(row.document_title),
    where: text(locator.label),
    headingPath: text(row.heading_path),
    text: text(row.text),
    score: count(row.score),
    why: text(row.why),
  }
}

/** 线形 → 一次检索结果。 */
export function toSearchResult(value: unknown): KnowledgeSearchResult {
  const row = record(value, '检索')
  const hits = Array.isArray(row.hits) ? row.hits : []
  return {
    hits: hits.map(toHit),
    strategy: text(row.strategy),
    note: text(row.note),
  }
}

/** 线形 → 一次直传凭证。 */
export function toUploadTicket(value: unknown): KnowledgeUploadTicket {
  const row = record(value, '直传凭证')
  const fields = isRecord(row.fields) ? row.fields : {}
  const pairs: Record<string, string> = {}
  for (const [name, one] of Object.entries(fields)) {
    pairs[name] = text(one)
  }
  return {
    documentId: text(row.document_id),
    url: text(row.url),
    fields: pairs,
    expiresSeconds: count(row.expires_seconds),
  }
}

/** 线形 → 能力。 */
export function toCapability(value: unknown): KnowledgeCapability {
  const row = record(value, '能力')
  const index = record(row.index, '索引档')
  return {
    isEmbeddingEnabled: row.is_embedding_enabled === true,
    isModelEnabled: row.is_model_enabled === true,
    isAsrEnabled: row.is_asr_enabled === true,
    strategies: strings(row.strategies),
    readyStrategies: strings(row.ready_strategies),
    acceptedSuffixes: strings(row.accepted_suffixes),
    index: {
      vector: text(index.vector),
      keyword: text(index.keyword),
      reason: text(index.reason),
    },
  }
}
