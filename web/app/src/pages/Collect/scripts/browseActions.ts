/** @fileoverview 地址空间的有界分页、子树勾选与请求隔离。 */
import type { Ref } from 'vue'
import type { CollectBrowseResult } from '@dt/contracts'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import {
  findNode,
  graftSubtree,
  mergeNodes,
  toNodes,
  unloadedUnder,
  variablesUnder,
  type NodeSelection,
  type TreeNode,
} from './browseTree'

export interface Ctx {
  sourceId: () => string
  taken: Ref<Set<string>>
  roots: Ref<TreeNode[]>
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  nextToken: Ref<string | null>
  error: Ref<string | null>
  selected: Ref<Set<string>>
  states: ReadonlyMap<string, NodeSelection>
  requests: Map<string | null, RacedFetch>
}

export interface ToggleOutcome {
  isWhole: boolean
  changed: number
  total: number
  error: string | null
}

const NOOP: ToggleOutcome = { isWhole: true, changed: 0, total: 0, error: null }

function requestFor(ctx: Ctx, address: string | null): RacedFetch {
  const existing = ctx.requests.get(address)
  if (existing !== undefined) return existing
  const request = useRacedFetch()
  ctx.requests.set(address, request)
  return request
}

export function cancelRequests(ctx: Ctx): void {
  for (const request of ctx.requests.values()) request.cancel()
  ctx.requests.clear()
}

export async function loadRoot(ctx: Ctx): Promise<void> {
  cancelRequests(ctx)
  ctx.roots.value = []
  ctx.selected.value = new Set()
  ctx.nextToken.value = null
  ctx.loadingMore.value = false
  ctx.loading.value = true
  ctx.error.value = null
  const sourceId = ctx.sourceId()
  await requestFor(ctx, null).run(
    (signal) => collect.browseSource(sourceId, null, signal),
    {
      ok: (result) => {
        ctx.roots.value = toNodes(result.items)
        ctx.nextToken.value = result.continuation_token
      },
      fail: (caught) => {
        ctx.error.value = describeError(caught)
      },
      settled: () => {
        ctx.loading.value = false
      },
    },
  )
}

function applyPage(node: TreeNode, result: CollectBrowseResult): void {
  node.children = mergeNodes(node.children ?? [], toNodes(result.items))
  node.nextToken = result.continuation_token
  node.isIncomplete = false
  node.hasChildren = node.children.length > 0 || node.nextToken !== null
}

async function loadChildren(ctx: Ctx, node: TreeNode): Promise<void> {
  node.isLoading = true
  node.error = null
  const sourceId = ctx.sourceId()
  const page =
    node.nextToken === null ? {} : { continuationToken: node.nextToken }
  await requestFor(ctx, node.address).run(
    (signal) => collect.browseSource(sourceId, node.address, signal, page),
    {
      ok: (result) => {
        applyPage(node, result)
        node.isOpen = true
      },
      fail: (caught) => {
        node.error = describeError(caught)
      },
      settled: () => {
        node.isLoading = false
      },
    },
  )
}

export async function loadMore(
  ctx: Ctx,
  address: string | null,
): Promise<void> {
  if (address !== null) {
    const node = findNode(ctx.roots.value, address)
    if (
      node === null ||
      node.isLoading ||
      (node.nextToken === null && !node.isIncomplete)
    )
      return
    await loadChildren(ctx, node)
    return
  }
  if (
    ctx.loading.value ||
    ctx.loadingMore.value ||
    ctx.nextToken.value === null
  )
    return
  ctx.loadingMore.value = true
  ctx.error.value = null
  const sourceId = ctx.sourceId()
  const continuationToken = ctx.nextToken.value
  await requestFor(ctx, null).run(
    (signal) =>
      collect.browseSource(sourceId, null, signal, { continuationToken }),
    {
      ok: (result) => {
        ctx.roots.value = mergeNodes(ctx.roots.value, toNodes(result.items))
        ctx.nextToken.value = result.continuation_token
      },
      fail: (caught) => {
        ctx.error.value = describeError(caught)
      },
      settled: () => {
        ctx.loadingMore.value = false
      },
    },
  )
}

export async function expand(ctx: Ctx, address: string): Promise<void> {
  const node = findNode(ctx.roots.value, address)
  if (node === null || node.isLoading) return
  if (node.children !== null) {
    node.isOpen = !node.isOpen
    return
  }
  await loadChildren(ctx, node)
}

async function loadSubtree(
  ctx: Ctx,
  node: TreeNode,
): Promise<ToggleOutcome | null> {
  if (unloadedUnder(node).length === 0) return NOOP
  node.isLoading = true
  node.error = null
  let outcome: ToggleOutcome | null = null
  const sourceId = ctx.sourceId()
  await requestFor(ctx, node.address).run(
    (signal) => collect.browseSubtree(sourceId, node.address, signal),
    {
      ok: (result) => {
        const isWhole = !result.is_truncated
        graftSubtree(node, result.items, isWhole)
        outcome = { ...NOOP, isWhole }
      },
      fail: (caught) => {
        node.error = describeError(caught)
        outcome = { ...NOOP, error: node.error }
      },
      settled: () => {
        node.isLoading = false
      },
    },
  )
  return outcome
}

function pick(ctx: Ctx, node: TreeNode, isOn: boolean): number {
  const next = new Set(ctx.selected.value)
  const before = next.size
  for (const one of variablesUnder(node)) {
    if (ctx.taken.value.has(one.address)) continue
    if (isOn) next.add(one.address)
    else next.delete(one.address)
  }
  ctx.selected.value = next
  return Math.abs(next.size - before)
}

function toggleOne(ctx: Ctx, address: string): void {
  const next = new Set(ctx.selected.value)
  if (next.has(address)) next.delete(address)
  else next.add(address)
  ctx.selected.value = next
}

export async function toggle(
  ctx: Ctx,
  address: string,
): Promise<ToggleOutcome> {
  const node = findNode(ctx.roots.value, address)
  if (node === null || node.isLoading) return NOOP
  if (node.isVariable) {
    if (ctx.taken.value.has(address)) return NOOP
    toggleOne(ctx, address)
    return { isWhole: true, changed: 1, total: 1, error: null }
  }
  if (ctx.states.get(address) === 'all')
    return outcomeOf(true, pick(ctx, node, false), node)
  const loaded = await loadSubtree(ctx, node)
  if (loaded === null) return NOOP
  if (loaded.error !== null) return loaded
  node.isOpen = true
  return outcomeOf(loaded.isWhole, pick(ctx, node, true), node)
}

function outcomeOf(
  isWhole: boolean,
  changed: number,
  node: TreeNode,
): ToggleOutcome {
  return { isWhole, changed, total: variablesUnder(node).length, error: null }
}
