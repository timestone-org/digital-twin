/**
 * @fileoverview 「还有活在跑就定时刷新」的轮询：到终态停表，卸载后不再起表。
 * ⚠ 上一次没回来就跳过这一拍：刷新走竞态防护时后发顶掉先发，响应慢于间隔会让
 * 每次响应都被作废，界面停更且不报错。
 */
import { onBeforeUnmount } from 'vue'

export interface BusyPolling {
  /** 按最新状态起表或停表。 */
  sync: (isBusy: boolean) => void
  stop: () => void
  /** 页面是否已卸载；卸载后才回来的写操作靠它收手。 */
  isDisposed: () => boolean
}

/**
 * 装上一页的轮询，卸载时自动停表。
 * @param refresh 刷新一次
 * @param intervalMs 间隔
 */
export function useBusyPolling(
  refresh: () => Promise<void>,
  intervalMs: number,
): BusyPolling {
  let timer: ReturnType<typeof setInterval> | null = null
  let isRefreshing = false
  let isDisposed = false

  async function tick(): Promise<void> {
    if (isRefreshing) return
    isRefreshing = true
    try {
      await refresh()
    } finally {
      isRefreshing = false
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function sync(isBusy: boolean): void {
    if (!isBusy) return stop()
    if (isDisposed || timer !== null) return
    timer = setInterval(() => void tick(), intervalMs)
  }

  onBeforeUnmount(() => {
    isDisposed = true
    stop()
  })

  return { sync, stop, isDisposed: () => isDisposed }
}
