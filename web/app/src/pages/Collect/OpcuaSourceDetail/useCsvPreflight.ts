/**
 * @fileoverview 导入前的预检：解析文件、比对库里已有的编码、算出真正会提交的那批。
 *
 * ⚠ 三类问题必须分得开，混成一句「导入失败」用户就只能一行行试：
 * 1. **这一行读不了**（格式错）——要回文件里改，行号得指得回去。
 * 2. **文件里自己撞了编码**——同样只能改文件，后端会以 400 拒整批。
 * 3. **库里已经有这个编码**——可以选择跳过，不改文件也能继续。
 *
 * ⚠ 已有编码要**全量**扫：只比对当前页，第二页往后的冲突要到提交时才以 409
 * 冒出来，而那时整批已经被拒了。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CollectPointItemInput } from '@dt/contracts'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { duplicatedCodes, parsePointCsv, type ParseResult } from './pointCsv'

/** 扫已有编码时一次取多少条。⚠ 与后端单页上限对齐，取大了会被 422。 */
const SCAN_PAGE_SIZE = 100

/** 表格里的一条「读不了」。`id` 只是给表格做键。 */
export interface ErrorRow {
  id: string
  line: number
  error: string
}

export interface CsvPreflight {
  fileName: Ref<string>
  parsed: Ref<ParseResult | null>
  /** 取不到已有点位时的原因；取到了就是 null。 */
  scanError: Ref<string | null>
  isSkippingExisting: Ref<boolean>
  goodCount: ComputedRef<number>
  errorRows: ComputedRef<ErrorRow[]>
  duplicated: ComputedRef<string[]>
  conflicting: ComputedRef<string[]>
  /** 真正会提交的那些。跳过已存在时把冲突行滤掉。 */
  submittable: ComputedRef<CollectPointItemInput[]>
  /** 文件内撞码只能改文件：跳过开关救不了它。 */
  isBlocked: ComputedRef<boolean>
  /** 重置并重新扫一遍库里已有的编码。弹窗打开时调。 */
  reset: (sourceId: string) => Promise<void>
  /** 收下一份文件。 */
  take: (file: File) => Promise<void>
}

/** 造一套预检状态。 */
export function useCsvPreflight(): CsvPreflight {
  const fileName = ref('')
  const parsed = ref<ParseResult | null>(null)
  const scanError = ref<string | null>(null)
  const isSkippingExisting = ref(true)
  const existingCodes = ref(new Set<string>())

  const goodRows = computed(() =>
    (parsed.value?.rows ?? []).flatMap((row) =>
      row.item === null ? [] : [row.item],
    ),
  )

  const errorRows = computed<ErrorRow[]>(() =>
    (parsed.value?.rows ?? [])
      .filter((row) => row.error !== null)
      .map((row) => ({
        id: String(row.line),
        line: row.line,
        error: row.error ?? '',
      })),
  )

  const duplicated = computed(() => duplicatedCodes(parsed.value?.rows ?? []))

  const conflicting = computed(() =>
    goodRows.value
      .filter((item) => existingCodes.value.has(item.code))
      .map((item) => item.code),
  )

  const submittable = computed(() =>
    goodRows.value.filter(
      (item) =>
        !isSkippingExisting.value || !existingCodes.value.has(item.code),
    ),
  )

  async function reset(sourceId: string): Promise<void> {
    fileName.value = ''
    parsed.value = null
    scanError.value = null
    existingCodes.value = await scanExisting(sourceId).catch((caught) => {
      scanError.value = describeError(caught)
      return new Set<string>()
    })
  }

  async function take(file: File): Promise<void> {
    fileName.value = file.name
    parsed.value = parsePointCsv(await file.text())
  }

  return {
    fileName,
    parsed,
    scanError,
    isSkippingExisting,
    goodCount: computed(() => goodRows.value.length),
    errorRows,
    duplicated,
    conflicting,
    submittable,
    isBlocked: computed(() => duplicated.value.length > 0),
    reset,
    take,
  }
}

/** 翻完这个数据源下的全部点位编码。 */
async function scanExisting(sourceId: string): Promise<Set<string>> {
  const codes = new Set<string>()
  let page = 1
  for (;;) {
    const chunk = await collect.listPoints({
      sourceId,
      page,
      size: SCAN_PAGE_SIZE,
    })
    for (const point of chunk.items) codes.add(point.code)
    if (codes.size >= chunk.total || chunk.items.length === 0) break
    page += 1
  }
  return codes
}
