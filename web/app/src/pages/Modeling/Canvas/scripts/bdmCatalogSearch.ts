/** @fileoverview 为不支持过滤的能管目录提供完整检索、分页和面板内缓存。 */
import type { ModelingBdmCatalog, ModelingBdmCatalogItem } from '@dt/contracts'

type Kind = ModelingBdmCatalog['kind']
export interface BdmCatalogRequest {
  kind: Kind
  page: number
  size?: number | undefined
  keyword?: string | undefined
}
export interface BdmSearchProgress {
  loaded: number
  total: number
}
type FetchPage = (
  query: BdmCatalogRequest,
  signal?: AbortSignal,
) => Promise<ModelingBdmCatalog>
type Progress = (value: BdmSearchProgress) => void

const PAGE_SIZE = 200
const CONCURRENCY = 4
const MAX_ITEMS = 50_000
const MAX_CHARACTERS = 12_000_000
const LOAD_BUDGET_MS = 120_000
const CACHE_TTL_MS = 300_000

export class BdmCatalogSearchError extends Error {}

interface LoadContext {
  kind: Kind
  fetchPage: FetchPage
  signal: AbortSignal
  progress: Progress
  now: () => number
  started: number
}
interface Collected {
  first: ModelingBdmCatalog
  items: ModelingBdmCatalogItem[]
  identifiers: Set<string>
  characters: number
}
interface Snapshot {
  catalog: ModelingBdmCatalog
  created: number
}

function assertActive(context: LoadContext): void {
  if (context.signal.aborted)
    throw new DOMException('目录搜索已取消', 'AbortError')
  if (context.now() - context.started > LOAD_BUDGET_MS)
    throw new BdmCatalogSearchError('完整目录读取超时，请重新搜索')
}

function consumePage(
  collected: Collected,
  page: ModelingBdmCatalog,
  expected: number,
): void {
  if (
    page.kind !== collected.first.kind ||
    page.page !== expected ||
    page.size !== PAGE_SIZE ||
    page.total !== collected.first.total
  )
    throw new BdmCatalogSearchError(
      '目录分页或总数发生变化，搜索未完成，请重试',
    )
  const count = Math.min(
    PAGE_SIZE,
    Math.max(0, page.total - (expected - 1) * PAGE_SIZE),
  )
  if (page.items.length !== count)
    throw new BdmCatalogSearchError('目录数据未读取完整，请重试')
  collected.characters += JSON.stringify(page.items).length
  if (collected.characters > MAX_CHARACTERS)
    throw new BdmCatalogSearchError('目录内容超过完整搜索容量，未返回部分结果')
  for (const item of page.items) {
    if (collected.identifiers.has(item.identifier))
      throw new BdmCatalogSearchError('目录中出现重复标识，搜索未完成，请重试')
    collected.identifiers.add(item.identifier)
    collected.items.push(item)
  }
}

function fulfilled(
  result: PromiseSettledResult<ModelingBdmCatalog>,
): ModelingBdmCatalog {
  if (result.status === 'fulfilled') return result.value
  const reason: unknown = result.reason
  throw reason instanceof Error
    ? reason
    : new BdmCatalogSearchError('目录读取失败，请重试')
}

async function readBatch(
  context: LoadContext,
  start: number,
  count: number,
): Promise<ModelingBdmCatalog[]> {
  assertActive(context)
  const pending = Array.from({ length: count }, (_, offset) =>
    context.fetchPage(
      {
        kind: context.kind,
        page: start + offset,
        size: PAGE_SIZE,
      },
      context.signal,
    ),
  )
  const results = await Promise.allSettled(pending)
  assertActive(context)
  return results.map(fulfilled)
}

async function loadSnapshot(context: LoadContext): Promise<ModelingBdmCatalog> {
  const first = (await readBatch(context, 1, 1))[0]
  if (
    first === undefined ||
    first.kind !== context.kind ||
    !Number.isSafeInteger(first.total) ||
    first.total < 0
  )
    throw new BdmCatalogSearchError('目录总数无效，无法完整搜索')
  if (first.total > MAX_ITEMS)
    throw new BdmCatalogSearchError('目录超过 50000 项，未返回部分搜索结果')
  const collected: Collected = {
    first,
    items: [],
    identifiers: new Set(),
    characters: 0,
  }
  consumePage(collected, first, 1)
  context.progress({ loaded: collected.items.length, total: first.total })
  const pages = Math.ceil(first.total / PAGE_SIZE)
  for (let start = 2; start <= pages; start += CONCURRENCY) {
    const batch = await readBatch(
      context,
      start,
      Math.min(CONCURRENCY, pages - start + 1),
    )
    batch.forEach((page, index) => consumePage(collected, page, start + index))
    context.progress({ loaded: collected.items.length, total: first.total })
  }
  return { ...first, items: collected.items }
}

function selectPage(
  catalog: ModelingBdmCatalog,
  query: BdmCatalogRequest,
): ModelingBdmCatalog {
  const keyword = (query.keyword ?? '').trim().toLowerCase()
  const matches = catalog.items.filter((item) =>
    [item.name, item.code, item.identifier, item.system ?? ''].some((value) =>
      value.toLowerCase().includes(keyword),
    ),
  )
  const size = query.size ?? 50
  return {
    ...catalog,
    total: matches.length,
    page: query.page,
    size,
    items: matches.slice((query.page - 1) * size, query.page * size),
  }
}

export function createBdmCatalogReader(
  fetchPage: FetchPage,
  now: () => number = Date.now,
) {
  const snapshots = new Map<Kind, Snapshot>()
  async function read(
    query: BdmCatalogRequest,
    signal: AbortSignal,
    progress: Progress,
  ): Promise<ModelingBdmCatalog> {
    if (query.kind === 'point') return await fetchPage(query, signal)
    const saved = snapshots.get(query.kind)
    const age = saved === undefined ? CACHE_TTL_MS : now() - saved.created
    if (saved !== undefined && age >= 0 && age < CACHE_TTL_MS)
      return selectPage(saved.catalog, query)
    snapshots.delete(query.kind)
    if (!(query.keyword ?? '').trim())
      return await fetchPage({ ...query, keyword: undefined }, signal)
    const context = {
      kind: query.kind,
      fetchPage,
      signal,
      progress,
      now,
      started: now(),
    }
    const catalog = await loadSnapshot(context)
    assertActive(context)
    snapshots.set(query.kind, { catalog, created: now() })
    return selectPage(catalog, query)
  }
  return {
    read,
    clear: (kind: Kind) => {
      snapshots.delete(kind)
    },
  }
}
