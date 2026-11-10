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
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useWorkspaceDashboard } from '@/features/workspace/useWorkspaceDashboard'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { disposeDoc } from '@/features/dashboard/docIo'

import type { Twin2dDoc } from './twin2dDoc'
import { TWIN_2D_MISSING_NODE_MESSAGE } from './twin2dNodeDoc'
import { createTwin2dReload, createTwin2dSave } from './twin2dPageIo'
import type { Twin2dPageState } from './twin2dPageIo'

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
  /** 上一次保存失败（版本冲突除外）的那句话；不挡编辑，只给提示用。 */
  saveError: Ref<string | null>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
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
    loadError: ref<string | null>(null),
    saveError: ref<string | null>(null),
    file: {
      dashboard: ref<DashboardPayload | null>(null),
      loading: ref(false),
      saving: ref(false),
      error: ref<string | null>(null),
      conflict: ref<string | null>(null),
    },
  }
  const raced = useRacedFetch()
  useWorkspaceDashboard(() => page.file.dashboard.value)
  const reload = createTwin2dReload(page, raced, dashboardId, nodeId)
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
      page.missing.value ? TWIN_2D_MISSING_NODE_MESSAGE : page.loadError.value,
    ),
    conflict: page.file.conflict,
    save: createTwin2dSave(page, nodeId),
    reload,
    saveError: page.saveError,
    dispose: () => disposeDoc(page.file, raced.cancel),
  }
}
