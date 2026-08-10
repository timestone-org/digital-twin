/**
 * @fileoverview 全局消息队列（单例）。`DtToastHost` 负责渲染，业务侧只管入队。
 */

import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import type { DtIntent } from '@dt/contracts'

export interface DtToast {
  id: number
  intent: DtIntent
  title: string | undefined
  message: string
  /** 自动消失的毫秒数；0 表示不自动消失。 */
  duration: number
}

export interface DtToastOptions {
  title?: string
  /** 覆盖默认时长；0 表示要用户手动关。 */
  duration?: number
}

/** 失败要读完，给足时间；成功一眼扫过就行。 */
const DURATION_MS = { error: 6000, default: 3500 }

const items = ref<DtToast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let sequence = 0

function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
  items.value = items.value.filter((item) => item.id !== id)
}

function push(
  intent: DtIntent,
  message: string,
  options: DtToastOptions = {},
): number {
  const id = ++sequence
  const duration =
    options.duration ??
    (intent === 'danger' ? DURATION_MS.error : DURATION_MS.default)
  items.value = [
    ...items.value,
    { id, intent, message, title: options.title, duration },
  ]
  if (duration > 0) {
    // ⚠ 句柄要存下来：手动关掉之后定时器还在跑，会去删一个已经不存在的 id，
    // 更要紧的是它让组件卸载后仍有待触发的回调。
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    )
  }
  return id
}

function clear(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  items.value = []
}

interface ToastApi {
  toasts: DeepReadonly<Ref<DtToast[]>>
  info: (message: string, options?: DtToastOptions) => number
  success: (message: string, options?: DtToastOptions) => number
  warning: (message: string, options?: DtToastOptions) => number
  error: (message: string, options?: DtToastOptions) => number
  dismiss: (id: number) => void
  clear: () => void
}

export function useToast(): ToastApi {
  return {
    toasts: readonly(items),
    info: (message, options) => push('info', message, options),
    success: (message, options) => push('success', message, options),
    warning: (message, options) => push('warning', message, options),
    error: (message, options) => push('danger', message, options),
    dismiss,
    clear,
  }
}
