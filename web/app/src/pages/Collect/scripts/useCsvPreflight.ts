/** @fileoverview CSV 预检：全量比对编码、检查新增缺项与文件重复。 */
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import type { CollectPointImportItemInput } from '@dt/contracts'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import {
  duplicatedCodes,
  parsePointCsv,
  type ParseResult,
  type ParsedRow,
} from './pointCsv'

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
  isScanning: Ref<boolean>
  goodCount: ComputedRef<number>
  errorRows: ComputedRef<ErrorRow[]>
  duplicated: ComputedRef<string[]>
  conflicting: ComputedRef<string[]>
  /** 真正会提交的那些。跳过已存在时把冲突行滤掉。 */
  submittable: ComputedRef<CollectPointImportItemInput[]>
  /** 文件内撞码只能改文件：跳过开关救不了它。 */
  isBlocked: ComputedRef<boolean>
  /** 重置并重新扫一遍库里已有的编码。弹窗打开时调。 */
  reset: (sourceId: string) => Promise<void>
  /** 收下一份文件。 */
  take: (file: File) => Promise<void>
  cancel: () => void
}

/** 由「解析结果 + 库里已有编码 + 跳过开关」派生出来的那几件。 */
type Derived = Pick<
  CsvPreflight,
  | 'goodCount'
  | 'errorRows'
  | 'duplicated'
  | 'conflicting'
  | 'submittable'
  | 'isBlocked'
>

function derive(
  parsed: Ref<ParseResult | null>,
  existing: Ref<Set<string>>,
  isSkipping: Ref<boolean>,
): Derived {
  const rows = computed(() =>
    (parsed.value?.rows ?? []).map((row) => checkNewRow(row, existing.value)),
  )
  const good = computed(() =>
    rows.value.flatMap((row) => (row.item === null ? [] : [row.item])),
  )
  const duplicated = computed(() => duplicatedCodes(rows.value))
  return {
    goodCount: computed(() => good.value.length),
    errorRows: computed(() =>
      rows.value
        .filter((row) => row.error !== null)
        .map((row) => ({
          id: String(row.line),
          line: row.line,
          error: row.error ?? '',
        })),
    ),
    duplicated,
    conflicting: computed(() =>
      good.value
        .filter((item) => existing.value.has(item.code))
        .map((item) => item.code),
    ),
    submittable: computed(() =>
      good.value.filter(
        (item) => !isSkipping.value || !existing.value.has(item.code),
      ),
    ),
    isBlocked: computed(() => duplicated.value.length > 0),
  }
}

function checkNewRow(row: ParsedRow, existing: ReadonlySet<string>): ParsedRow {
  const item = row.item
  if (item === null || existing.has(item.code)) return row
  const missing = [
    item.name === undefined ? '名称' : '',
    item.address === undefined ? '寻址串' : '',
  ].filter(Boolean)
  return missing.length === 0
    ? row
    : { ...row, item: null, error: `新增点位的${missing.join('、')}不能为空` }
}

export function useCsvPreflight(): CsvPreflight {
  const fileName = ref('')
  const parsed = ref<ParseResult | null>(null)
  const scanError = ref<string | null>(null)
  const isSkippingExisting = ref(false)
  const isScanning = ref(false)
  const existingCodes = ref(new Set<string>())
  const scan = useRacedFetch()
  const fileRead = useRacedFetch()

  function cancel(): void {
    scan.cancel()
    fileRead.cancel()
    isScanning.value = false
  }
  onScopeDispose(cancel)

  async function reset(sourceId: string): Promise<void> {
    fileName.value = ''
    parsed.value = null
    scanError.value = null
    fileRead.cancel()
    existingCodes.value = new Set<string>()
    isScanning.value = true
    await scan.run((signal) => scanExisting(sourceId, signal), {
      ok: (codes) => {
        existingCodes.value = codes
      },
      fail: (caught) => {
        scanError.value = describeError(caught)
      },
      settled: () => {
        isScanning.value = false
      },
    })
  }

  return {
    fileName,
    parsed,
    scanError,
    isSkippingExisting,
    isScanning,
    ...derive(parsed, existingCodes, isSkippingExisting),
    reset,
    take: (file) => readCsvFile(file, { fileName, parsed }, fileRead),
    cancel,
  }
}

async function readCsvFile(
  file: File,
  state: Pick<CsvPreflight, 'fileName' | 'parsed'>,
  reader: RacedFetch,
): Promise<void> {
  state.fileName.value = file.name
  state.parsed.value = null
  await reader.run(async () => parsePointCsv(await file.text()), {
    ok: (result) => {
      state.parsed.value = result
    },
    fail: () => {
      state.parsed.value = { rows: [], fatal: '文件读取失败，请重新选择文件' }
    },
    settled: () => undefined,
  })
}

/** 翻完这个数据源下的全部点位编码。 */
async function scanExisting(
  sourceId: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  const codes = new Set<string>()
  let page = 1
  for (;;) {
    const chunk = await collect.listPoints(
      {
        sourceId,
        page,
        size: SCAN_PAGE_SIZE,
      },
      signal,
    )
    for (const point of chunk.items) codes.add(point.code)
    if (codes.size >= chunk.total || chunk.items.length === 0) break
    page += 1
  }
  return codes
}
