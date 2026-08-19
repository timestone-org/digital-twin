/**
 * @fileoverview 公开大屏的文档加载：按公开令牌匿名取一张屏，带竞态防护。
 *
 * ⚠ 换屏（联动跳转）会在同一个组件实例里换令牌，所以「后发的请求先回」是常态。
 * 竞态防护走 `useRacedFetch`，不手搓——手搓一份就会漏路径，而漏了不报错。
 * ⚠ 重新加载时**不清空已有文档**：清了的话墙上每跳一次先白一下，而这一页是
 * 拿去投到墙上的（`DashboardView` 同口径）。
 */

import type { PublicDashboardPayload } from '@dt/contracts'
import { ref, type Ref } from 'vue'

import { getPublicDashboard } from '@/api/dashboardShare'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

export interface PublicDashboardDoc {
  dashboard: Ref<PublicDashboardPayload | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** 按令牌加载；被更晚的一次加载顶掉时什么都不写。 */
  load: (publicToken: string) => Promise<void>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

/** 装一份公开大屏的加载状态。须在 setup 内调用（只为拿到响应式引用）。 */
export function usePublicDashboardDoc(): PublicDashboardDoc {
  const dashboard = ref<PublicDashboardPayload | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const raced = useRacedFetch()

  async function load(publicToken: string): Promise<void> {
    if (publicToken === '') return
    loading.value = true
    error.value = null
    await raced.run((signal) => getPublicDashboard(publicToken, signal), {
      ok: (payload) => {
        dashboard.value = payload
      },
      fail: (caught) => {
        // 令牌查不到与已撤回是同一个 404，文案不区分——区分等于告诉持链接
        // 的人「这张屏确实存在过」
        error.value = describeError(caught)
        // ⚠ 取不到就把画面撤掉：链接被撤回之后还留着上一屏，那就成了
        // 「看起来在跑、实际已经没人授权看它」
        dashboard.value = null
      },
      settled: () => {
        loading.value = false
      },
    })
  }

  return { dashboard, loading, error, load, dispose: raced.cancel }
}
