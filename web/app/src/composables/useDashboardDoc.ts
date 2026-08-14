/**
 * @fileoverview 一张大屏的加载与保存。
 *
 * ⚠ 加载防竞态：大屏可以被快速切换，慢的那次后返回会把新屏的内容覆盖成旧屏的，
 * 且**没有任何报错**。这里用序号 + AbortController 双保险——序号保证只有最后
 * 一次能写状态，AbortController 让被放弃的那次真的停下来而不是白跑完。
 * ⚠ 保存必带 `expected_version`，收到 409 一律交给调用方走「重新加载」，
 * 绝不静默重试或覆盖（ADR-0012）。
 */

import { ref, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'

import { BizError } from '@/api/client'
import {
  DASHBOARD_VERSION_CONFLICT_CODE,
  getDashboard,
  replaceLayout,
  type ReplaceLayoutInput,
} from '@/api/dashboard'
import { describeError } from '@/composables/useAsyncList'

/** 版本冲突时给用户看的一句话。 */
export const VERSION_CONFLICT_MESSAGE =
  '这张大屏在别处被改过，你手上的版本旧了。请重新加载后再改，避免覆盖别人的改动。'

const CONFLICT_HTTP_STATUS = 409

export interface DashboardDoc {
  dashboard: Ref<DashboardPayload | null>
  loading: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string | null>
  /** 版本冲突的提示；非 null 时界面必须挡住继续保存。 */
  conflict: Ref<string | null>
  /** 加载一张大屏；返回它，被更晚的一次加载取代时返回 null。 */
  load: (dashboardId: string) => Promise<DashboardPayload | null>
  /** 整树替换；成功返回新载荷，冲突或失败返回 null。 */
  save: (input: ReplaceLayoutInput) => Promise<DashboardPayload | null>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

interface DocState {
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
function createLoader(state: DocState) {
  let sequence = 0
  let inFlight: AbortController | null = null

  async function load(dashboardId: string): Promise<DashboardPayload | null> {
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    sequence += 1
    const mine = sequence
    state.loading.value = true
    state.error.value = null
    state.conflict.value = null
    try {
      const loaded = await getDashboard(dashboardId, controller.signal)
      if (mine !== sequence) return null
      state.dashboard.value = loaded
      return loaded
    } catch (caught) {
      if (mine !== sequence) return null
      state.error.value = describeError(caught)
      state.dashboard.value = null
      return null
    } finally {
      if (mine === sequence) state.loading.value = false
    }
  }

  function dispose(): void {
    inFlight?.abort()
    inFlight = null
    // ⚠ 推进序号：卸载后才返回的那次不许再写状态
    sequence += 1
  }

  return { load, dispose }
}

/** 整树替换；409 落到 `conflict`，其余落到 `error`。 */
function createSaver(state: DocState) {
  return async function save(
    input: ReplaceLayoutInput,
  ): Promise<DashboardPayload | null> {
    const current = state.dashboard.value
    if (current === null) return null
    state.saving.value = true
    state.error.value = null
    try {
      const saved = await replaceLayout(current.id, input)
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
}

export function useDashboardDoc(): DashboardDoc {
  const state: DocState = {
    dashboard: ref<DashboardPayload | null>(null),
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
  }
  const { load, dispose } = createLoader(state)
  return { ...state, load, save: createSaver(state), dispose }
}
