/**
 * @fileoverview 2D 孪生编辑器一页的取数与落库：从大屏上取出某个节点的那段
 * `configJson.twin2d`，改完整树替换回去。
 *
 * ⚠ 落库走大屏的**整树替换**，服务端没有单节点写入口——同屏其余节点必须原样
 * 带回去，漏一个就是把它删了，而界面上只会显示「保存成功」。
 * ⚠ 取数走 `useRacedFetch`：`:dashboardId` / `:nodeId` 能在**同一个组件实例**上变
 * （从属性面板反复进出不同节点的子编辑器），慢的那次后返回会盖掉新文档，
 * 且没有任何报错（docs/MODULE_TWIN_2D_DESIGN.md §13.5）。取数在这一页自己做而不是
 * 借大屏文档壳那一份，是要让「哪张屏」与「哪个节点」在同一回合里一起定住。
 * ⚠ 409 的口径只有 `docIo` 一份，保存借它的 `createSaver`，不在这里另写一套。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'

import { getDashboard } from '@/api/dashboard'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { RacedFetch } from '@/composables/useRacedFetch'
import { createSaver } from '@/features/dashboard/docIo'
import type { DocState } from '@/features/dashboard/docIo'
import { toLayoutInput } from '@/features/dashboard/editorDoc'

import {
  TWIN_2D_MISSING_NODE_MESSAGE,
  nodesWithTwin2d,
  twin2dDocOf,
} from './twin2dNodeDoc'
import type { Twin2dDoc } from './twin2dDoc'

export interface Twin2dEditorPage {
  doc: ComputedRef<Twin2dDoc | null>
  dashboard: Ref<DashboardPayload | null>
  node: ComputedRef<DashboardNodePayload | null>
  /**
   * 这块 2D 孪生在大屏上占多大（设计像素）；节点还没读出来时是 undefined。
   * ⚠ 编辑画布按它算取景：不按它算的话，编辑区与大屏格子的宽高比不同，同一份
   * 配置两边缩放档不一样——看起来就是「上了大屏之后整张图小了一圈」。
   */
  targetSize: ComputedRef<{ width: number; height: number } | undefined>
  loading: Ref<boolean>
  saving: Ref<boolean>
  /** 取数失败、或这张屏上根本没有这个节点。 */
  error: ComputedRef<string | null>
  /** 版本冲突的提示；非 null 时界面必须挡住继续保存并给出「重新加载」。 */
  conflict: Ref<string | null>
  save: () => Promise<boolean>
  /** 冲突或加载失败之后的出口：整份重取，本地未保存的改动就此丢弃。 */
  reload: () => Promise<void>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

/** 一页的可变状态；取数与落库两支动作都写它。 */
interface Twin2dPageState {
  /**
   * ⚠ 文档态与「哪个节点」绑死：切了节点必须整份重建，沿用旧的会把 A 的撤销栈
   * 接到 B 头上，一次撤销就把 B 改成 A 的内容。
   * ⚠ `shallowRef` 不是随手写的：`ref` 会把里面的 ComputedRef 逐个解包，
   * `doc.value.config` 从 ref 变成裸值，类型对不上且失去响应。
   */
  doc: ShallowRef<Twin2dDoc | null>
  /** 这张屏读出来了，但里面没有这个节点。 */
  missing: Ref<boolean>
  file: DocState
}

/**
 * 造「整份重取」的动作。
 * ⚠ `forNode` 在发起那一刻捕获：这一回合能落地就说明它仍是最后一次，用当下的
 * `nodeId()` 只会在两者相同时碰巧对。
 * @param page 一页的可变状态
 * @param raced 竞态闸
 * @param dashboardId 取当前大屏 id
 * @param nodeId 取当前要编辑的节点 id
 */
function createReload(
  page: Twin2dPageState,
  raced: RacedFetch,
  dashboardId: () => string,
  nodeId: () => string,
): () => Promise<void> {
  const file = page.file
  function apply(loaded: DashboardPayload, forNode: string): void {
    file.dashboard.value = loaded
    const next = twin2dDocOf(loaded.nodes, forNode)
    page.missing.value = next === null
    page.doc.value = next
  }
  return async () => {
    const forNode = nodeId()
    page.doc.value = null
    page.missing.value = false
    file.loading.value = true
    file.error.value = null
    file.conflict.value = null
    await raced.run((signal) => getDashboard(dashboardId(), signal), {
      ok: (loaded) => apply(loaded, forNode),
      fail: (caught) => {
        file.error.value = describeError(caught)
        file.dashboard.value = null
      },
      settled: () => {
        file.loading.value = false
      },
    })
  }
}

/**
 * 造「整树替换落库」的动作；成功返回 true。
 * @param page 一页的可变状态
 * @param nodeId 取当前要编辑的节点 id
 */
function createSave(
  page: Twin2dPageState,
  nodeId: () => string,
): () => Promise<boolean> {
  const replace = createSaver(page.file)
  return async () => {
    const current = page.file.dashboard.value
    const editing = page.doc.value
    if (current === null || editing === null) return false
    const saved = await replace({
      expectedVersion: current.rowVersion,
      nodes: toLayoutInput(nodesWithTwin2d(current, nodeId(), editing)),
    })
    if (saved === null) return false
    editing.markSaved()
    return true
  }
}

/**
 * 装上一页的状态。
 * @param dashboardId 取当前大屏 id
 * @param nodeId 取当前要编辑的节点 id
 */
export function useTwin2dEditorPage(
  dashboardId: () => string,
  nodeId: () => string,
): Twin2dEditorPage {
  const page: Twin2dPageState = {
    doc: shallowRef<Twin2dDoc | null>(null),
    missing: ref(false),
    file: {
      dashboard: ref<DashboardPayload | null>(null),
      loading: ref(false),
      saving: ref(false),
      error: ref<string | null>(null),
      conflict: ref<string | null>(null),
    },
  }
  const raced = useRacedFetch()
  const reload = createReload(page, raced, dashboardId, nodeId)
  const node = computed<DashboardNodePayload | null>(
    () =>
      page.file.dashboard.value?.nodes.find((item) => item.id === nodeId()) ??
      null,
  )
  watch([dashboardId, nodeId], () => void reload(), { immediate: true })

  return {
    doc: computed(() => page.doc.value),
    dashboard: page.file.dashboard,
    node,
    targetSize: computed(() =>
      node.value === null
        ? undefined
        : { width: node.value.w, height: node.value.h },
    ),
    loading: page.file.loading,
    saving: page.file.saving,
    error: computed(() =>
      page.missing.value ? TWIN_2D_MISSING_NODE_MESSAGE : page.file.error.value,
    ),
    conflict: page.file.conflict,
    save: createSave(page, nodeId),
    reload,
    dispose: raced.cancel,
  }
}
