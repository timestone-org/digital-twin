/** @fileoverview 报告自动刷新、原件读取与竞态防护。 */
import type { ReportRenderDetail } from '@dt/contracts'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { downloadReport, getReportRender } from '@/api/reports'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import { findLatestReport, type LatestReport } from './latestReport'

export interface ReportView extends LatestReport {
  blob: Blob
  detail: ReportRenderDetail
}

/** 当前生成记录未改变时沿用已取得的原件。 */
async function loadReport(
  code: string,
  current: ReportView | null,
  signal: AbortSignal,
): Promise<ReportView | null> {
  const latest = await findLatestReport(code, signal)
  signal.throwIfAborted()
  if (!latest) return null
  if (current?.record.id === latest.record.id) return current
  const [detail, blob] = await Promise.all([
    getReportRender(latest.record.id, signal),
    downloadReport(latest.record.id, signal),
  ])
  return { ...latest, detail, blob }
}

/** 轮询只在空闲时读取，卸载清理定时器。 */
function useAutoRefresh(
  seconds: () => number,
  loading: () => boolean,
  reload: () => Promise<void>,
): void {
  let timer: ReturnType<typeof setInterval> | undefined
  watch(
    seconds,
    (value) => {
      if (timer !== undefined) clearInterval(timer)
      if (value > 0)
        timer = setInterval(
          () => {
            if (!loading()) void reload()
          },
          Math.max(10, value) * 1000,
        )
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    if (timer !== undefined) clearInterval(timer)
  })
}

/** 最新报告的状态与显式刷新入口。 */
export function useLatestReport(
  code: () => string,
  seconds: () => number,
  allowed: () => boolean,
) {
  const document = shallowRef<ReportView | null>(null)
  const loading = ref(false)
  const error = ref('')
  const raced = useRacedFetch()
  async function reload(): Promise<void> {
    if (!allowed()) return
    loading.value = true
    error.value = ''
    await raced.run((signal) => loadReport(code(), document.value, signal), {
      ok: (value) => {
        document.value = value
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        loading.value = false
      },
    })
  }
  watch(
    [code, allowed],
    () => {
      raced.cancel()
      document.value = null
      error.value = ''
      loading.value = false
      if (allowed()) void reload()
    },
    { immediate: true },
  )
  useAutoRefresh(seconds, () => loading.value, reload)
  onBeforeUnmount(raced.cancel)
  return { document, loading, error, reload }
}
