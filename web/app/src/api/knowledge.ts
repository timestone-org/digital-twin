/**
 * @fileoverview 知识库面的接口封装：库、来源、文档直传三步、检索。
 *
 * ⚠ 直传的第二步**不经过本站 API**：浏览器拿着签好的表单直接 POST 到对象存储。
 * 让字节穿过 API 进程的话，一个几百 MB 的手册会把一个 worker 占住几十秒。
 * ⚠ 路径写**相对知识库前缀**的那一段，前缀由 `onKnowledge` 铺进 `baseUrl`：
 * 把整条 `/api/v1/knowledge/...` 当 path 传，客户端会再拼一次缺省的 auth 前缀，
 * 拿回来的是一个 403 的 HTML 页，前端只说得出「服务端响应格式异常」。
 */
import { KNOWLEDGE_BASE_URL } from '@/config/app'
import { request, requestData } from './client'
import type { RequestOptions } from './client'
import { postUploadForm } from './upload'
import type { UploadOptions } from './upload'
import {
  toBase,
  toCapability,
  toDocument,
  toSearchResult,
  toSource,
  toUploadTicket,
} from './knowledgeWire'
import type {
  KnowledgeBase,
  KnowledgeCapability,
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeSource,
} from './knowledgeWire'

export type {
  KnowledgeBase,
  KnowledgeCapability,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeIndexLanes,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeUploadTicket,
} from './knowledgeWire'

/** 这份内容已经在这个库里了（领域 23）。⚠ 按码分支，不按 message。 */
export const KNOWLEDGE_DUPLICATE_CODE = 42308
/** 这个库还检索不了（没配嵌入档 / 还没建过索引）。 */
export const KNOWLEDGE_RETRIEVAL_UNAVAILABLE_CODE = 42306

const BASES = '/knowledge-bases'
const DOCUMENTS = '/documents'
const SOURCES = '/sources'

function onKnowledge(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: KNOWLEDGE_BASE_URL }
}

interface PageWire {
  items?: unknown
}

function itemsOf(value: unknown): unknown[] {
  const page = value as PageWire
  return Array.isArray(page.items) ? page.items : []
}

/** 这套部署此刻的知识库能力。 */
export async function readCapability(): Promise<KnowledgeCapability> {
  return toCapability(
    await requestData<unknown>('/capabilities', onKnowledge()),
  )
}

/** 列知识库。 */
export async function listBases(): Promise<KnowledgeBase[]> {
  const page = await requestData<unknown>(
    BASES,
    onKnowledge({ query: { page: 1, size: 100 } }),
  )
  return itemsOf(page).map(toBase)
}

/** 建一个知识库。 */
export async function createBase(
  name: string,
  description: string,
  strategy: string,
): Promise<KnowledgeBase> {
  return toBase(
    await requestData<unknown>(
      BASES,
      onKnowledge({
        method: 'POST',
        body: {
          name,
          description,
          retrieval_strategy: strategy,
        },
      }),
    ),
  )
}

/**
 * 删一个知识库。它名下的文档、块与原件一起没。
 *
 * ⚠ 走 `request` 而不是 `requestData`：204 没有响应体，而后者见 null 就抛
 * 「服务端未返回数据」——一次**成功**的删除会被读成失败。
 */
export async function deleteBase(baseId: string): Promise<void> {
  await request<unknown>(
    `${BASES}/${baseId}`,
    onKnowledge({ method: 'DELETE' }),
  )
}

/** 一个库下的来源。 */
export async function listSources(baseId: string): Promise<KnowledgeSource[]> {
  const rows = await requestData<unknown[]>(
    `${BASES}/${baseId}/sources`,
    onKnowledge(),
  )
  return rows.map(toSource)
}

/** 跑一次来源同步。回这一次登记了几条、跳过几条、还有没有更多。 */
export async function syncSource(sourceId: string): Promise<{
  registered: number
  skipped: number
  hasMore: boolean
}> {
  const made = await requestData<{
    registered?: number
    skipped?: number
    has_more?: boolean
  }>(`${SOURCES}/${sourceId}:sync`, onKnowledge({ method: 'POST' }))
  return {
    registered: made.registered ?? 0,
    skipped: made.skipped ?? 0,
    hasMore: made.has_more === true,
  }
}

/**
 * 列一个库下的文档。
 * @param baseId 哪个库
 * @param signal 换库时用来中止上一次；不给即不可中止
 */
export async function listDocuments(
  baseId: string,
  signal?: AbortSignal,
): Promise<KnowledgeDocument[]> {
  const page = await requestData<unknown>(
    DOCUMENTS,
    onKnowledge({ query: { base_id: baseId, page: 1, size: 200 }, signal }),
  )
  return itemsOf(page).map(toDocument)
}

/**
 * 传一份文档：签凭证 → 浏览器直传 → 登记。
 *
 * ⚠ 三步缺一不可，而且**签凭证那一步不落行**：没传成的文档不会在库里留下
 * 半条记录，界面上也就不会出现一份永远停在「待处理」的鬼影。
 * @param baseId 传进哪个库
 * @param file 用户选的文件
 * @param options 取消信号与进度回调
 */
export async function uploadDocument(
  baseId: string,
  file: File,
  options: UploadOptions = {},
): Promise<KnowledgeDocument> {
  const ticket = toUploadTicket(
    await requestData<unknown>(
      `${DOCUMENTS}:upload-ticket`,
      onKnowledge({
        method: 'POST',
        query: { base_id: baseId },
        body: {
          filename: file.name,
          content_type: file.type,
          size_bytes: file.size,
        },
      }),
    ),
  )
  await postUploadForm(ticket.url, ticket.fields, file, options)
  return toDocument(
    await requestData<unknown>(
      DOCUMENTS,
      onKnowledge({
        method: 'POST',
        query: { base_id: baseId },
        body: { document_id: ticket.documentId, filename: file.name },
      }),
    ),
  )
}

/**
 * 重新解析一份文档。
 * ⚠ 这是这条链路上**唯一**的重试入口，而且它由人按：一份解不动的文档自动
 * 重试一万次也解不动，只会把后台占满。
 */
export async function reparseDocument(
  documentId: string,
): Promise<KnowledgeDocument> {
  return toDocument(
    await requestData<unknown>(
      `${DOCUMENTS}/${documentId}:reparse`,
      onKnowledge({ method: 'POST' }),
    ),
  )
}

/** 删一份文档。它的块与原件一起没。⚠ 同上走 `request`：204 没有响应体。 */
export async function deleteDocument(documentId: string): Promise<void> {
  await request<unknown>(
    `${DOCUMENTS}/${documentId}`,
    onKnowledge({ method: 'DELETE' }),
  )
}

/** 在一个库里检索。 */
export async function searchBase(
  baseId: string,
  query: string,
  strategy = '',
): Promise<KnowledgeSearchResult> {
  return toSearchResult(
    await requestData<unknown>(
      `${BASES}/${baseId}:search`,
      onKnowledge({
        method: 'POST',
        body: { query, limit: 8, strategy },
      }),
    ),
  )
}
