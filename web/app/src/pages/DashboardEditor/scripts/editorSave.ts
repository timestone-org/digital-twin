/**
 * @fileoverview 双轴保存的编排。顺序不变量：元数据轴先行——PATCH 会推进行版本，
 * 布局轴的 `expected_version` 必须取推进后的值，反过来做布局轴必 409。
 */
import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type { useDashboardDoc } from '@/composables/useDashboardDoc'
import { toLayoutInput } from '@/features/dashboard/editorDoc'
import type { EditorMeta } from './useEditorMeta'

export interface SaveDeps {
  editor: DashboardEditor
  file: ReturnType<typeof useDashboardDoc>
  meta: EditorMeta
  /** 失败提示出口；文案由调用方按 conflict/error 组装。 */
  onFail: () => void
}

/** 保存两条轴；全部成功返回 true。 */
export async function saveDashboard(deps: SaveDeps): Promise<boolean> {
  const { editor, file, meta } = deps
  if (file.dashboard.value === null) return false
  const patch = meta.toPatch()
  if (patch !== null) {
    const savedMeta = await file.saveMeta(patch)
    if (savedMeta === null) {
      deps.onFail()
      return false
    }
    meta.reset(savedMeta)
  }
  if (editor.isDirty.value || patch === null) {
    const fresh = file.dashboard.value
    if (fresh === null) return false
    const saved = await file.save({
      expectedVersion: fresh.rowVersion,
      nodes: toLayoutInput(editor.nodes.value),
    })
    if (saved === null) {
      deps.onFail()
      return false
    }
    editor.reset(saved.nodes)
  }
  return true
}
