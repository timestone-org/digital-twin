/**
 * @fileoverview 孪生编辑器一页的取数与落库：从大屏上取出某个节点的孪生配置，
 * 改完整树替换回去。
 *
 * ⚠ 落库走的是大屏的**整树替换**，不是只存这一个节点——服务端没有单节点写入口。
 * 所以这里必须把同屏其余节点原样带回去，漏一个就是把它删了。
 * ⚠ 页面上的「保存」会推进大屏行版本，大屏编辑器那边的本地草稿会因此失效。
 * 入口处（`useSubEditorEntry`）已经挡过一次脏状态，这里不再重复挡。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { TWIN_CONFIG_KEY, normalizeTwinConfig } from '@dt/twin-config'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { useDashboardDoc } from '@/composables/useDashboardDoc'
import { toLayoutInput } from '@/features/dashboard/editorDoc'

import { createTwinDoc, type TwinDoc } from './twinDoc'

export interface TwinEditorPage {
  doc: ComputedRef<TwinDoc | null>
  dashboard: Ref<DashboardPayload | null>
  node: ComputedRef<DashboardNodePayload | null>
  loading: Ref<boolean>
  saving: Ref<boolean>
  /** 取数失败、或这张屏上根本没有这个节点。 */
  error: ComputedRef<string | null>
  conflict: Ref<string | null>
  save: () => Promise<boolean>
  dispose: () => void
}

/** 读出节点上那段孪生配置；没有就是一份空配置。 */
function twinOf(node: DashboardNodePayload): unknown {
  return node.configJson[TWIN_CONFIG_KEY]
}

/**
 * 把这个节点上的孪生配置与绑定装成一份文档态。
 * @param nodes 服务端返回的整棵节点树
 * @param nodeId 要编辑的节点
 */
function docOf(
  nodes: readonly DashboardNodePayload[],
  nodeId: string,
): TwinDoc | null {
  const target = nodes.find((item) => item.id === nodeId)
  if (target === undefined) return null
  return createTwinDoc({
    config: normalizeTwinConfig(twinOf(target)),
    bindings: target.bindings,
  })
}

/**
 * 把改动写回这个节点，其余节点原样带上。
 * ⚠ 少带一个节点就是把它删了，而界面上只会显示保存成功。
 * @param current 服务端当前这份载荷
 * @param nodeId 被编辑的节点
 * @param doc 文档态
 */
function nodesWithTwin(
  current: DashboardPayload,
  nodeId: string,
  doc: TwinDoc,
): DashboardNodePayload[] {
  return current.nodes.map((item) =>
    item.id === nodeId
      ? {
          ...item,
          configJson: {
            ...item.configJson,
            [TWIN_CONFIG_KEY]: doc.config.value,
          },
          bindings: [...doc.bindings.value],
        }
      : item,
  )
}

/**
 * 装上一页的状态。
 * @param dashboardId 大屏 id
 * @param nodeId 要编辑的节点 id
 */
export function useTwinEditorPage(
  dashboardId: () => string,
  nodeId: () => string,
): TwinEditorPage {
  const file = useDashboardDoc()
  // ⚠ 文档态与「哪个节点」绑死：切了节点必须整份重建，沿用旧的会把 A 的
  //   撤销栈接到 B 头上，一次撤销就把 B 改成 A 的内容
  // ⚠ shallowRef 不是随手写的：`ref` 会把对象里的 ComputedRef 逐个解包，
  //   `doc.value.config` 会从 ref 变成裸值，类型对不上且失去响应
  const doc = shallowRef<TwinDoc | null>(null)
  const missing = ref(false)

  const node = computed<DashboardNodePayload | null>(
    () =>
      file.dashboard.value?.nodes.find((item) => item.id === nodeId()) ?? null,
  )

  async function reload(id: string): Promise<void> {
    doc.value = null
    missing.value = false
    const loaded = await file.load(id)
    // 被更晚的一次加载取代；这一次的结果整份丢弃
    if (loaded === null) return
    const next = docOf(loaded.nodes, nodeId())
    if (next === null) missing.value = true
    doc.value = next
  }

  watch([dashboardId, nodeId], ([id]) => void reload(id), { immediate: true })

  async function save(): Promise<boolean> {
    const current = file.dashboard.value
    const editing = doc.value
    if (current === null || editing === null) return false

    const saved = await file.save({
      expectedVersion: current.rowVersion,
      nodes: toLayoutInput(nodesWithTwin(current, nodeId(), editing)),
    })
    if (saved === null) return false
    editing.markSaved()
    return true
  }

  return {
    doc: computed(() => doc.value),
    dashboard: file.dashboard,
    node,
    loading: file.loading,
    saving: file.saving,
    error: computed(() =>
      missing.value
        ? '这张大屏上没有这个节点，可能已被删除。'
        : file.error.value,
    ),
    conflict: file.conflict,
    save,
    dispose: file.dispose,
  }
}
