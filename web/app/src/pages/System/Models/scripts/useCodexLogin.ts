/**
 * @fileoverview 设备码登录的那一段状态：开个头、按上游给的间隔轮询、成了收摊。
 *
 * ⚠ 打的是 **platform** 那一族端点（ADR-0041）：登录态与那一路供应商同属主，
 * 助手与知识库都经平台的内部面领令牌，谁都不另存一份。
 *
 * ⚠ 间隔**必须用返回值里的那个**。上游让慢下来时它会变大，照原间隔接着打的话，
 * 被限流的是整台机器而不只是这一次登录。
 *
 * ⚠ 卸载与重开都要停：不停的话，离开这一页之后定时器还在打，而它每一次都
 * 带着一个已经作废的句柄。
 *
 * ⚠ 竞态按后一次为准：连点两下「登录」时，前一次的轮询立刻作废——不作废的话
 * 两条轮询会交替刷新同一块状态，界面在两个用户码之间来回跳。
 */
import { onScopeDispose, ref, type Ref } from 'vue'
import type { LlmCredential, LlmDeviceLoginStart } from '@dt/contracts'

import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  forgetCredential,
  pollDeviceLogin,
  readCredential,
  startDeviceLogin,
} from '@/api/llmProviders'

/** 上游没给间隔时按这个数轮询。 */
const FALLBACK_INTERVAL_S = 5

export interface CodexLogin {
  status: Ref<LlmCredential | null>
  /** 正在等人去确认的那一次；没有就是 null。 */
  pending: Ref<LlmDeviceLoginStart | null>
  isBusy: Ref<boolean>
  error: Ref<string>
  refresh: () => Promise<void>
  begin: () => Promise<void>
  cancel: () => void
  signOut: () => Promise<void>
}

/** 轮询那一半：只管「隔多久再问一次」与「立刻作废」。 */
interface Polling {
  startAt: (ref_: string, seconds: number) => void
  stop: () => void
}

/**
 * 造一个轮询器。
 * ⚠ 在途那一次的作废交给 `useRacedFetch`（仓里唯一一份竞态防护）：
 * 光 `clearTimeout` 拦得住还没发的，拦不住已经发出去的那一次。
 * @param onEach 到点了做什么；返回下一次隔多久，返回 null 表示收摊
 */
function createPolling(
  onEach: (ref_: string, signal: AbortSignal) => Promise<number | null>,
): Polling {
  const raced = useRacedFetch()
  let timer: ReturnType<typeof setTimeout> | null = null

  function stop(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    raced.cancel()
  }

  function startAt(ref_: string, seconds: number): void {
    timer = setTimeout(
      () => {
        void raced.run((signal) => onEach(ref_, signal), {
          ok: (next) => {
            if (next !== null) startAt(ref_, next)
          },
          fail: () => undefined,
          settled: () => undefined,
        })
      },
      Math.max(seconds, 1) * 1000,
    )
  }

  return { startAt, stop }
}

/**
 * 造一段设备码登录的状态。
 * ⚠ 收一个**那一路供应商的 id** 而不是写死一个名字：目录里能配出好几路订阅
 * 账号，各自一份登录态；写死的话，第二路点登录时改的是第一路。
 * ⚠ 收的是个**取值口子**而不是取值：调用方多半是从 props 里拿它的，
 * 在根作用域读一次会把响应性丢掉（`vue/no-setup-props-reactivity-loss`）。
 * @param providerRef 取那一路供应商的 id
 */
export function useCodexLogin(providerRef: () => string): CodexLogin {
  const status = ref<LlmCredential | null>(null)
  const pending = ref<LlmDeviceLoginStart | null>(null)
  const isBusy = ref(false)
  const error = ref('')

  const polling = createPolling(async (ref_, signal) => {
    try {
      const polled = await pollDeviceLogin(providerRef(), ref_, signal)
      if (!polled.is_done) {
        // ⚠ 用回来的那个间隔，不是我们自己记的
        return polled.interval_s || FALLBACK_INTERVAL_S
      }
      status.value = polled.credential
    } catch (caught) {
      error.value = describe(caught)
    }
    pending.value = null
    return null
  })

  onScopeDispose(polling.stop)

  async function begin(): Promise<void> {
    polling.stop()
    await guarded({ isBusy, error }, async () => {
      const started = await startDeviceLogin(providerRef())
      pending.value = started
      polling.startAt(started.ref, started.interval_s)
    })
  }

  async function refresh(): Promise<void> {
    status.value = await readCredential(providerRef())
  }

  return {
    status,
    pending,
    isBusy,
    error,
    refresh,
    begin,
    cancel: () => {
      polling.stop()
      pending.value = null
    },
    signOut: () =>
      guarded({ isBusy, error }, async () => {
        await forgetCredential(providerRef())
        status.value = null
        await refresh()
      }),
  }
}

/**
 * 跑一次会写状态的动作：转圈、清错、失败时把话说出来。
 * @param flags 转圈与错误两格
 * @param action 真正要做的事
 */
async function guarded(
  flags: { isBusy: Ref<boolean>; error: Ref<string> },
  action: () => Promise<void>,
): Promise<void> {
  flags.isBusy.value = true
  flags.error.value = ''
  try {
    await action()
  } catch (caught) {
    flags.error.value = describe(caught)
  } finally {
    flags.isBusy.value = false
  }
}

function describe(caught: unknown): string {
  return caught instanceof Error ? caught.message : '这一步没成'
}
