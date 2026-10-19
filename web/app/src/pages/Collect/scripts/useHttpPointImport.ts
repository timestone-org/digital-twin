/** @fileoverview JSON 点位映射导入的编码预检与批量提交。 */
import { ref, type Ref } from 'vue'
import type { CollectPointItemInput } from '@dt/contracts'
import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { importPoints, type ImportOutcome } from './pointImport'

async function scanExisting(
  sourceId: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  const codes = new Set<string>()
  for (let page = 1; ; page += 1) {
    const chunk = await collect.listPoints(
      { sourceId, page, size: 100 },
      signal,
    )
    for (const point of chunk.items) codes.add(point.code)
    if (codes.size >= chunk.total || chunk.items.length === 0) return codes
  }
}

interface ImportContext {
  sourceId: () => string
  existing: Ref<Set<string>>
  isScanning: Ref<boolean>
  isSubmitting: Ref<boolean>
  error: Ref<string | null>
  outcome: Ref<ImportOutcome | null>
  scan: ReturnType<typeof useRacedFetch>
  submission: ReturnType<typeof useRacedFetch>
}

async function reset(ctx: ImportContext): Promise<void> {
  cancel(ctx)
  ctx.existing.value = new Set()
  ctx.error.value = null
  ctx.outcome.value = null
  ctx.isScanning.value = true
  await ctx.scan.run((signal) => scanExisting(ctx.sourceId(), signal), {
    ok: (codes) => {
      ctx.existing.value = codes
    },
    fail: (caught) => {
      ctx.error.value = `无法读取已有点位：${describeError(caught)}`
    },
    settled: () => {
      ctx.isScanning.value = false
    },
  })
}

async function submit(
  ctx: ImportContext,
  items: readonly CollectPointItemInput[],
  onImported: () => void,
): Promise<void> {
  if (
    ctx.isSubmitting.value ||
    ctx.isScanning.value ||
    ctx.error.value !== null ||
    items.length === 0
  )
    return
  const target = ctx.sourceId()
  ctx.isSubmitting.value = true
  await ctx.submission.run(() => importPoints(target, items), {
    ok: (result) => {
      ctx.outcome.value = result
      if (result.created > 0) onImported()
    },
    fail: (caught) => {
      ctx.error.value = describeError(caught)
    },
    settled: () => {
      ctx.isSubmitting.value = false
    },
  })
}

function cancel(ctx: ImportContext): void {
  ctx.scan.cancel()
  ctx.submission.cancel()
  ctx.isScanning.value = false
  ctx.isSubmitting.value = false
}

export function useHttpPointImport(sourceId: () => string) {
  const ctx: ImportContext = {
    sourceId,
    existing: ref(new Set<string>()),
    isScanning: ref(false),
    isSubmitting: ref(false),
    error: ref<string | null>(null),
    outcome: ref<ImportOutcome | null>(null),
    scan: useRacedFetch(),
    submission: useRacedFetch(),
  }
  return {
    existing: ctx.existing,
    isScanning: ctx.isScanning,
    isSubmitting: ctx.isSubmitting,
    error: ctx.error,
    outcome: ctx.outcome,
    reset: () => reset(ctx),
    submit: (items: readonly CollectPointItemInput[], onImported: () => void) =>
      submit(ctx, items, onImported),
    cancel: () => cancel(ctx),
  }
}
