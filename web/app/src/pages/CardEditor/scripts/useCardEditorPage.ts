/**
 * @fileoverview 自定义卡片这一页的取数与落库：从大屏上取出某个节点，改它的
 * `configJson`，改完整树替换回去。
 *
 * ⚠ 落库走大屏的**整树替换**，服务端没有单节点写入口——同屏其余节点必须原样带回去，
 * 漏一个就是把它删了，而界面上只会显示「保存成功」。
 * ⚠ 取数走 `useRacedFetch`：`:dashboardId` / `:nodeId` 能在**同一个组件实例**上变
 * （从右键菜单反复进出不同节点），慢的那次后返回会盖掉新文档，且没有任何报错。
 * ⚠ 409 的口径只有 `docIo` 一份，保存借它的 `createSaver`，不在这里另写一套。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { computed, ref, shallowRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { getDashboard } from '@/api/dashboard'
import type { ReplaceLayoutInput } from '@/api/dashboard'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { RacedFetch } from '@/composables/useRacedFetch'
import { createSaver } from '@/features/dashboard/docIo'
import type { DocState } from '@/features/dashboard/docIo'
import { toLayoutInput } from '@/features/dashboard/editorDoc'

/** 这张屏读出来了，但里面没有这个节点。 */
export const CARD_MISSING_NODE_MESSAGE = '这张大屏上没有这个卡片节点'

export interface CardEditorPage {
  node: ComputedRef<DashboardNodePayload | null>
  loading: Ref<boolean>
  saving: Ref<boolean>
  /** 取数失败、或这张屏上根本没有这个节点。 */
  error: ComputedRef<string | null>
  /** 版本冲突；非 null 时界面必须挡住继续保存并给出「重新加载」。 */
  conflict: Ref<string | null>
  /** 本地改过还没存。 */
  isDirty: Ref<boolean>
  /** 改这个节点的整份 config。⚠ 整袋替换，调用方负责把没改的键带回来。 */
  setConfig: (next: Record<string, unknown>) => void
  load: () => Promise<void>
  save: () => Promise<boolean>
  dispose: () => void
}

/** 一页的可变状态；取数与落库两支动作都写它。 */
interface CardPageState {
  doc: DocState
  missing: Ref<boolean>
  isDirty: Ref<boolean>
  raced: RacedFetch
  nodeId: () => string
}

/**
 * 整份重取。
 * @param state 状态袋
 * @param dashboardId 取哪张屏
 */
async function loadInto(
  state: CardPageState,
  dashboardId: string,
): Promise<void> {
  if (dashboardId === '') return
  const { doc } = state
  doc.loading.value = true
  doc.error.value = null
  doc.conflict.value = null
  state.missing.value = false
  await state.raced.run((signal) => getDashboard(dashboardId, signal), {
    ok: (payload) => {
      doc.dashboard.value = payload
      state.missing.value = !payload.nodes.some(
        (one) => one.id === state.nodeId(),
      )
      state.isDirty.value = false
    },
    fail: (caught) => {
      doc.error.value = describeError(caught)
    },
    settled: () => {
      doc.loading.value = false
    },
  })
}

/**
 * 改这个节点的整份 config。
 * ⚠ 换出一份新的 `dashboard` 而不是就地改：`shallowRef` 只认引用变化，就地改的话
 * 预览与表单都不会重算，用户看到的是「拖了没反应」。
 * @param state 状态袋
 * @param next 新的整份配置
 */
function setConfigOn(
  state: CardPageState,
  next: Record<string, unknown>,
): void {
  const current = state.doc.dashboard.value
  if (current === null) return
  state.doc.dashboard.value = {
    ...current,
    nodes: current.nodes.map((one) =>
      one.id === state.nodeId() ? { ...one, configJson: next } : one,
    ),
  }
  state.isDirty.value = true
}

/**
 * 整树替换落库。
 * @param state 状态袋
 * @param save0 借 `docIo` 那份 409 口径
 */
async function saveFrom(
  state: CardPageState,
  save0: (input: ReplaceLayoutInput) => Promise<DashboardPayload | null>,
): Promise<boolean> {
  const current = state.doc.dashboard.value
  if (current === null) return false
  const saved = await save0({
    // ⚠ 带上当前行版本：不带就成了「无条件覆盖」，别人在这期间改过的会被静默抹掉
    expectedVersion: current.rowVersion,
    nodes: toLayoutInput(current.nodes),
  })
  if (saved === null) return false
  state.doc.dashboard.value = saved
  state.isDirty.value = false
  return true
}

/**
 * 装配这一页。须在 setup 内调用。
 * @param dashboardId 取哪张屏
 * @param nodeId 改哪个节点
 */
export function useCardEditorPage(
  dashboardId: () => string,
  nodeId: () => string,
): CardEditorPage {
  const dashboard = shallowRef<DashboardPayload | null>(null)
  const doc: DocState = {
    dashboard,
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
  }
  const state: CardPageState = {
    doc,
    missing: ref(false),
    isDirty: ref(false),
    raced: useRacedFetch(),
    nodeId,
  }
  const save0 = createSaver(doc)

  const node = computed<DashboardNodePayload | null>(
    () => dashboard.value?.nodes.find((one) => one.id === nodeId()) ?? null,
  )

  const error = computed(() =>
    state.missing.value ? CARD_MISSING_NODE_MESSAGE : doc.error.value,
  )

  return {
    node,
    loading: doc.loading,
    saving: doc.saving,
    error,
    conflict: doc.conflict,
    isDirty: state.isDirty,
    setConfig: (next) => setConfigOn(state, next),
    load: () => loadInto(state, dashboardId()),
    save: () => saveFrom(state, save0),
    dispose: state.raced.cancel,
  }
}
