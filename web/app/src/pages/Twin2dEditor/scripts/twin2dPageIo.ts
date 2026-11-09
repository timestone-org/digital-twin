/**
 * @fileoverview 2D 孪生编辑器一页的两支动作：整份重取与整树替换落库。
 *
 * ⚠ 409 的口径只有 `docIo` 一份，保存借它的 `createSaver`，不在这里另写一套。
 */
import type { DashboardPayload } from '@dt/contracts'
import type { Ref, ShallowRef } from 'vue'

import { getDashboard } from '@/api/dashboard'
import { describeError } from '@/composables/useAsyncList'
import type { RacedFetch } from '@/composables/useRacedFetch'
import { createSaver } from '@/features/dashboard/docIo'
import type { DocState } from '@/features/dashboard/docIo'
import { toLayoutInput } from '@/features/dashboard/editorDoc'

import type { Twin2dDoc } from './twin2dDoc'
import { nodesWithTwin2d, twin2dDocOf } from './twin2dNodeDoc'

/** 一页的可变状态；取数与落库两支动作都写它。 */
export interface Twin2dPageState {
  /**
   * ⚠ 文档态与「哪个节点」绑死：切了节点必须整份重建，沿用旧的会把 A 的撤销栈
   * 接到 B 头上，一次撤销就把 B 改成 A 的内容。
   * ⚠ `shallowRef` 不是随手写的：`ref` 会把里面的 ComputedRef 逐个解包，
   * `doc.value.config` 从 ref 变成裸值，类型对不上且失去响应。
   */
  doc: ShallowRef<Twin2dDoc | null>
  /** 这张屏读出来了，但里面没有这个节点。 */
  missing: Ref<boolean>
  /**
   * 取数失败的那句话。
   * ⚠ 与 `file.error` 分开：后者也收保存失败，混成一份的话一次 5xx 就把整个编辑器
   * 换成错误页，而那页唯一的「重试」是整份重取，未保存的改动一声不吭全丢。
   */
  loadError: Ref<string | null>
  /** 上一次保存失败（版本冲突除外）的那句话；存成功或重取时清掉。 */
  saveError: Ref<string | null>
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
export function createTwin2dReload(
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
    file.loadGeneration = (file.loadGeneration ?? 0) + 1
    file.isDisposed = false
    file.saving.value = false
    page.doc.value = null
    page.missing.value = false
    file.loading.value = true
    file.error.value = null
    page.loadError.value = null
    page.saveError.value = null
    file.conflict.value = null
    await raced.run((signal) => getDashboard(dashboardId(), signal), {
      ok: (loaded) => apply(loaded, forNode),
      fail: (caught) => {
        page.loadError.value = describeError(caught)
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
export function createTwin2dSave(
  page: Twin2dPageState,
  nodeId: () => string,
): () => Promise<boolean> {
  const replace = createSaver(page.file)
  return async () => {
    if (page.file.saving.value) return false
    const current = page.file.dashboard.value
    const editing = page.doc.value
    if (current === null || editing === null) return false
    editing.endMerge()
    const generation = page.file.loadGeneration ?? 0
    const snapshot = {
      config: editing.config.value,
      bindings: editing.bindings.value,
    }
    const saved = await replace({
      expectedVersion: current.rowVersion,
      nodes: toLayoutInput(nodesWithTwin2d(current, nodeId(), editing)),
    })
    page.saveError.value = page.file.error.value
    page.file.error.value = null
    if (saved === null) return false
    if (
      generation === (page.file.loadGeneration ?? 0) &&
      page.doc.value === editing
    )
      editing.markSaved(snapshot)
    return true
  }
}
