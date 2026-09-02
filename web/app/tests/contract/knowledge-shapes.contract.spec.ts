/**
 * @fileoverview 把 `@dt/contracts` 的知识库类型钉在 knowledge-server 的
 * openapi.json 上。
 *
 * 做法与 `assistant-shapes.contract.spec.ts` 同源，理由也同源：手写的类型比真
 * 接口宽松时，页面对着不存在的字段取值会拿到 undefined 并崩在渲染里，而
 * typecheck、lint、单测全绿——编译器无从知道后端把字段叫什么。
 *
 * ⚠ 还钉三个闭合集合：检索策略、来源种类、文档状态。它们在后端各存三份
 * （数据库 CHECK、模型常量、注册名），在前端存一份；任意两处漂开的表现都是
 * 「某个值永远选不中」，而每一处单看都对。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  KnowledgeAnswer,
  KnowledgeBase,
  KnowledgeCapability,
  KnowledgeChatAdvanceIn,
  KnowledgeChatMessage,
  KnowledgeChatSession,
  KnowledgeChatSessionDetail,
  KnowledgeChatStep,
  KnowledgeChatToolResult,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeIndexCapability,
  KnowledgeLocator,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeSyncResult,
  KnowledgeUploadTicket,
} from '@dt/contracts'
import {
  KNOWLEDGE_DOCUMENT_STATUSES,
  KNOWLEDGE_KEYWORD_LANES,
  KNOWLEDGE_SOURCE_KINDS,
  KNOWLEDGE_STRATEGIES,
  KNOWLEDGE_VECTOR_LANES,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SERVICE_DIR = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'knowledge-server',
)
const SPEC_PATH = join(SERVICE_DIR, 'openapi.json')

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, OpenApiSchema> }
}
const schemas = spec.components.schemas

type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  CapabilityOut: {
    is_embedding_enabled: true,
    is_model_enabled: true,
    is_asr_enabled: true,
    strategies: true,
    ready_strategies: true,
    source_kinds: true,
    accepted_suffixes: true,
    index: true,
  } satisfies Keys<KnowledgeCapability>,

  IndexCapabilityOut: {
    vector: true,
    keyword: true,
    reason: true,
  } satisfies Keys<KnowledgeIndexCapability>,

  KnowledgeBaseOut: {
    id: true,
    name: true,
    description: true,
    retrieval_strategy: true,
    embedding_model: true,
    dimensions: true,
    owner_id: true,
    document_count: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<KnowledgeBase>,

  SourceOut: {
    id: true,
    base_id: true,
    kind: true,
    name: true,
    config: true,
    last_synced_at: true,
    last_error: true,
    created_at: true,
  } satisfies Keys<KnowledgeSource>,

  DocumentOut: {
    id: true,
    base_id: true,
    source_id: true,
    title: true,
    media_type: true,
    byte_size: true,
    status: true,
    failure_reason: true,
    chunk_count: true,
    created_at: true,
    ready_at: true,
  } satisfies Keys<KnowledgeDocument>,

  UploadTicketOut: {
    document_id: true,
    url: true,
    fields: true,
    object_key: true,
    expires_seconds: true,
  } satisfies Keys<KnowledgeUploadTicket>,

  LocatorOut: {
    page: true,
    sheet: true,
    row: true,
    path: true,
    label: true,
  } satisfies Keys<KnowledgeLocator>,

  HitOut: {
    chunk_id: true,
    document_id: true,
    document_title: true,
    text: true,
    heading_path: true,
    locator: true,
    score: true,
    why: true,
  } satisfies Keys<KnowledgeHit>,

  SearchOut: {
    hits: true,
    strategy: true,
    rounds: true,
    is_complete: true,
    note: true,
  } satisfies Keys<KnowledgeSearchResult>,

  AskOut: {
    answer: true,
    citations: true,
    strategy: true,
    rounds: true,
    is_complete: true,
    note: true,
  } satisfies Keys<KnowledgeAnswer>,

  SyncOut: {
    registered: true,
    skipped: true,
    has_more: true,
  } satisfies Keys<KnowledgeSyncResult>,
  ChatStepOut: {
    id: true,
    message_id: true,
    seq: true,
    kind: true,
    name: true,
    state: true,
    input_json: true,
    output_json: true,
    error: true,
    started_at: true,
    ended_at: true,
    created_at: true,
  } satisfies Keys<KnowledgeChatStep>,
  ChatMessageOut: {
    id: true,
    session_id: true,
    seq: true,
    role: true,
    content_json: true,
    usage_json: true,
    steps: true,
    created_at: true,
  } satisfies Keys<KnowledgeChatMessage>,
  ChatSessionOut: {
    id: true,
    user_id: true,
    title: true,
    is_archived: true,
    row_version: true,
    last_error: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<KnowledgeChatSession>,
  ChatSessionDetailOut: {
    id: true,
    user_id: true,
    title: true,
    is_archived: true,
    row_version: true,
    last_error: true,
    created_at: true,
    updated_at: true,
    messages: true,
  } satisfies Keys<KnowledgeChatSessionDetail>,
  ToolResultIn: {
    call_id: true,
    output: true,
    error: true,
  } satisfies Keys<KnowledgeChatToolResult>,
  ChatAdvanceIn: {
    user_text: true,
    tool_results: true,
    client_tools: true,
  } satisfies Keys<KnowledgeChatAdvanceIn>,
}

/**
 * 后端某个常量元组里的字面量，按变量名取。
 *
 * ⚠ 取不到就抛，不返回空表：空表会让下面那几条断言在「后端把常量改了名」时
 * 静默变成「两边都是空的，所以相等」——那正是这条用例要拦的东西。
 */
function literalsOf(path: string, name: string): string[] {
  const text = readFileSync(join(SERVICE_DIR, path), 'utf8')
  const block = new RegExp(`${name}\\s*=\\s*\\(([^)]*)\\)`).exec(text)
  const body = block?.[1]
  if (body === undefined) {
    throw new Error(`没找到 ${name}，后端可能改了名字`)
  }
  const found = [...body.matchAll(/"([a-z_]+)"/g)].flatMap((one) =>
    one[1] === undefined ? [] : [one[1]],
  )
  if (found.length === 0) {
    throw new Error(`${name} 里一个字面量都没有，正则多半过期了`)
  }
  return found
}

const MODELS = join('src', 'knowledge_server', 'apps', 'knowledge', 'models')

describe('知识库线形与 openapi 一致', () => {
  it.each(Object.keys(SHAPES))('%s 的字段集合逐字对齐', (name) => {
    const schema = schemas[name]
    const expected = SHAPES[name]
    expect(schema, `openapi 里没有 ${name}`).toBeDefined()
    expect(expected, `SHAPES 里没有 ${name}`).toBeDefined()
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
      Object.keys(expected ?? {}).sort(),
    )
  })

  it('检索策略两侧逐字一致', () => {
    expect(literalsOf(join(MODELS, 'knowledge_base.py'), 'STRATEGIES')).toEqual(
      [...KNOWLEDGE_STRATEGIES],
    )
  })

  it('来源种类两侧逐字一致', () => {
    expect(literalsOf(join(MODELS, 'source.py'), 'KINDS')).toEqual([
      ...KNOWLEDGE_SOURCE_KINDS,
    ])
  })

  it('文档状态两侧逐字一致', () => {
    expect(literalsOf(join(MODELS, 'document.py'), 'STATUSES')).toEqual([
      ...KNOWLEDGE_DOCUMENT_STATUSES,
    ])
  })

  it('两路索引的档位名互不重复', () => {
    const names = [...KNOWLEDGE_VECTOR_LANES, ...KNOWLEDGE_KEYWORD_LANES]
    expect(new Set(names).size).toBe(names.length)
  })
})
