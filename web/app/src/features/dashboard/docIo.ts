/**
 * @fileoverview 大屏文档的 IO 工厂：防竞态加载器与两条保存轴（整树替换/元数据）。
 * 状态引用由 `useDashboardDoc` 持有并注入，这里只装配行为。
 * ⚠ 409 一律落 `conflict` 交界面走「重新加载」，绝不静默重试或覆盖（ADR-0012）。
 */
import type { Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'

import { BizError } from '@/api/client'
import {
  DASHBOARD_VERSION_CONFLICT_CODE,
  getDashboard,
  replaceLayout,
  updateDashboard,
  type DashboardPatchInput,
  type ReplaceLayoutInput,
} from '@/api/dashboard'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 版本冲突时给用户看的一句话。 */
export const VERSION_CONFLICT_MESSAGE =
  '这张大屏在别处被改过，你手上的版本旧了。请重新加载后再改，避免覆盖别人的改动。'

const CONFLICT_HTTP_STATUS = 409

export interface DocState {
  dashboard: Ref<DashboardPayload | null>
  loading: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string | null>
  conflict: Ref<string | null>
}

/** 这个错误是不是「你的版本旧了」。⚠ 按码分支，不按 message。 */
function isVersionConflict(caught: unknown): boolean {
  return (
    caught instanceof BizError &&
    (caught.code === DASHBOARD_VERSION_CONFLICT_CODE ||
      caught.status === CONFLICT_HTTP_STATUS)
  )
}

/** 只有最后一次发起的加载能写状态；乱序返回的那些一律丢弃。 */
export function createLoader(state: DocState): {
  load: (dashboardId: string) => Promise<DashboardPayload | null>
  dispose: () => void
} {
  const raced = useRacedFetch()

  async function load(dashboardId: string): Promise<DashboardPayload | null> {
    state.loading.value = true
    state.error.value = null
    state.conflict.value = null
    // 只有仍是最后一次的那回合会写它，故它就是本次调用该返回的东西
    let settled: DashboardPayload | null = null
    await raced.run((signal) => getDashboard(dashboardId, signal), {
      ok: (loaded) => {
        state.dashboard.value = loaded
        settled = loaded
      },
      fail: (caught) => {
        state.error.value = describeError(caught)
        state.dashboard.value = null
      },
      settled: () => (state.loading.value = false),
    })
    return settled
  }

  return { load, dispose: raced.cancel }
}

/** 一次保存动作的公共外壳：忙碌态、409 与其余错误的口径都在这里。 */
async function guarded(
  state: DocState,
  action: () => Promise<DashboardPayload>,
): Promise<DashboardPayload | null> {
  state.saving.value = true
  state.error.value = null
  try {
    const saved = await action()
    state.dashboard.value = saved
    state.conflict.value = null
    return saved
  } catch (caught) {
    if (isVersionConflict(caught)) {
      state.conflict.value = VERSION_CONFLICT_MESSAGE
    } else {
      state.error.value = describeError(caught)
    }
    return null
  } finally {
    state.saving.value = false
  }
}

/** 整树替换。 */
export function createSaver(
  state: DocState,
): (input: ReplaceLayoutInput) => Promise<DashboardPayload | null> {
  return async (input) => {
    const current = state.dashboard.value
    if (current === null) return null
    return guarded(state, () => replaceLayout(current.id, input))
  }
}

/** 元数据轴保存；成功后当前载荷换成新版本，行版本被推进。 */
export function createMetaSaver(
  state: DocState,
): (patch: DashboardPatchInput) => Promise<DashboardPayload | null> {
  return async (patch) => {
    const current = state.dashboard.value
    if (current === null) return null
    return guarded(state, () => updateDashboard(current.id, patch))
  }
}
