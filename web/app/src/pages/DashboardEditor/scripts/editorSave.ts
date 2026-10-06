/**
 * @fileoverview 双轴保存的编排。顺序不变量：元数据轴先行——PATCH 会推进行版本，
 * 布局轴的 `expected_version` 必须取推进后的值，反过来做布局轴必 409。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type { useDashboardDoc } from '@/composables/useDashboardDoc'
import type { SaveOutcome } from '@/features/ai/saveTool'
import { toLayoutInput } from '@/features/dashboard/editorDoc'
import { moduleConfigIssues } from '@/features/dashboard/moduleConfigIssues'
import type { EditorMeta } from './useEditorMeta'

export interface SaveDeps {
  editor: DashboardEditor
  file: ReturnType<typeof useDashboardDoc>
  meta: EditorMeta
  /** 失败提示出口；文案由调用方按 conflict/error 组装。 */
  onFail: () => void
}

/** 布局轴按发送快照落库，只有当前资源能接受保存基线。 */
async function saveLayout(
  deps: SaveDeps,
  snapshot: readonly DashboardNodePayload[],
  isCurrent: () => boolean,
): Promise<boolean> {
  const fresh = deps.file.dashboard.value
  if (fresh === null) return false
  const saved = await deps.file.save({
    expectedVersion: fresh.rowVersion,
    nodes: toLayoutInput(snapshot),
  })
  if (saved === null) {
    if (isCurrent()) deps.onFail()
    return false
  }
  if (isCurrent()) deps.editor.markSaved(snapshot, saved.nodes)
  return true
}

/** 保存两条轴；全部成功返回 true。 */
export async function saveDashboard(deps: SaveDeps): Promise<boolean> {
  const { editor, file, meta } = deps
  if (file.dashboard.value === null || file.saving.value || file.loading.value)
    return false
  const targetId = file.dashboard.value.id
  const version = file.resourceVersion
  const isCurrent = () =>
    file.resourceVersion === version && file.dashboard.value?.id === targetId
  editor.flush()
  const snapshot = editor.nodes.value
  const isLayoutDirty = editor.isDirty.value
  const patch = meta.toPatch()
  if (patch !== null) {
    const savedMeta = await file.saveMeta(patch)
    if (savedMeta === null) {
      if (isCurrent()) deps.onFail()
      return false
    }
    if (!isCurrent()) return !isLayoutDirty
    meta.acceptSaved(savedMeta, patch)
  }
  if (isLayoutDirty || patch === null) {
    return saveLayout(deps, snapshot, isCurrent)
  }
  return true
}

interface SaveWithFeedbackDeps {
  editor: DashboardEditor
  file: ReturnType<typeof useDashboardDoc>
  meta: EditorMeta
  getManifest: GetModuleManifest
  toast: {
    error: (message: string) => void
    success: (message: string) => void
  }
}

/** 校验全部模块后保存，并统一发送成功或失败反馈。 */
export async function saveDashboardWithFeedback(
  deps: SaveWithFeedbackDeps,
): Promise<SaveOutcome> {
  const issues = moduleConfigIssues(deps.editor.nodes.value, deps.getManifest)
  if (issues.length > 0) {
    const message = `配置无效：${issues.join('；')}`
    deps.toast.error(message)
    return { isSaved: false, message }
  }
  const failure: { message: string | null } = { message: null }
  const done = await saveDashboard({
    editor: deps.editor,
    file: deps.file,
    meta: deps.meta,
    onFail: () => {
      failure.message =
        deps.file.conflict.value ?? deps.file.error.value ?? '保存失败'
      deps.toast.error(failure.message)
    },
  })
  if (done) deps.toast.success('大屏已保存')
  return { isSaved: done, message: failure.message }
}
