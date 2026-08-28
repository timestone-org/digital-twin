/**
 * @fileoverview 页面级操作组：加载/保存/删除确认/选中项的几何与显隐/挑点回填，
 * 加上本地草稿流与离开守卫的装配。只做把状态层与动作层串起来这一件事。
 */
import type { Ref } from 'vue'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import type { CollectPoint } from '@dt/contracts'
import type { DashboardEditor } from '@/composables/useDashboardEditor'
import type { useDashboardDoc } from '@/composables/useDashboardDoc'
import type {
  GeometryDimension,
  NodeGeometry,
} from '@/features/dashboard/editorDoc'
import type { EditorActions } from './editorActions'
import type { ArrangeActions } from './editorArrange'
import type { SaveOutcome } from '@/features/ai/saveTool'
import { saveDashboard } from './editorSave'
import { useEditorDraftFlow } from './useEditorDraftFlow'
import type { EditorMeta } from './useEditorMeta'
import { useSubEditorEntry } from './useSubEditorEntry'

interface ConfirmPort {
  ask: (input: {
    title: string
    message: string
    confirmText: string
    danger: boolean
  }) => Promise<boolean>
}

interface ToastPort {
  error: (message: string) => void
  success: (message: string) => void
}

export interface EditorPageOpsDeps {
  editor: DashboardEditor
  actions: EditorActions
  arrange: ArrangeActions
  file: ReturnType<typeof useDashboardDoc>
  meta: EditorMeta
  confirm: ConfirmPort
  toast: ToastPort
  dashboardId: () => string
  pickingFieldKey: Ref<string | null>
}

export interface EditorPageOps {
  /** 模块库点击添加；钉位撞单例时提示而不是静默没反应。 */
  addModule: (manifest: ModuleManifest) => void
  removeNode: (nodeId: string) => Promise<void>
  removeSelected: () => Promise<void>
  reload: () => Promise<void>
  /** 保存两条轴。⚠ 回执带失败原因：助手那条保存工具靠它把 409 如实抛出去。 */
  save: () => Promise<SaveOutcome>
  changeSelectedGeometry: (
    geometry: NodeGeometry,
    isContinuous: boolean,
  ) => void
  /** 改整个选中集的显隐；单选时就是主选中一个。 */
  toggleSelectedVisible: (isVisible: boolean) => void
  pickPoint: (point: CollectPoint) => void
  closePicker: (open: boolean) => void
  /** Esc 的前置出口：挑点面板开着就先关它并报告已消费。 */
  consumePicker: () => boolean
}

const GEOMETRY_DIMENSIONS: readonly GeometryDimension[] = ['x', 'y', 'w', 'h']

/** 面板改的是哪一维：恰好一维在变时给维度键，几何合并键按它细分。 */
function changedDimensionOf(
  node: DashboardNodePayload,
  geometry: NodeGeometry,
): GeometryDimension | undefined {
  const changed = GEOMETRY_DIMENSIONS.filter(
    (key) => node[key] !== geometry[key],
  )
  return changed.length === 1 ? changed[0] : undefined
}

async function removeNode(
  deps: EditorPageOpsDeps,
  nodeId: string,
): Promise<void> {
  const ok = await deps.confirm.ask({
    title: '删除节点',
    message: '这个节点连同它的全部子节点与绑定都会被删掉，保存后不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (ok) deps.actions.removeNode(nodeId)
}

async function removeSelected(deps: EditorPageOpsDeps): Promise<void> {
  const count = deps.editor.selectedIds.value.length
  if (count === 0) return
  const ok = await deps.confirm.ask({
    title: '删除所选节点',
    message: `选中的 ${count} 个节点连同各自的子节点与绑定都会被删掉，保存后不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (ok) deps.arrange.removeSelected()
}

async function reload(deps: EditorPageOpsDeps): Promise<void> {
  const loaded = await deps.file.load(deps.dashboardId())
  if (loaded !== null) deps.editor.reset(loaded.nodes)
}

// 双轴保存的顺序不变量见 editorSave.ts
async function save(deps: EditorPageOpsDeps): Promise<SaveOutcome> {
  const { file, toast } = deps
  // ⚠ 用一只可变盒子而不是裸变量：赋值发生在回调里，TS 不跟踪那一次赋值，
  //   裸变量在返回处会被窄化成 null，于是失败原因永远传不出去
  const failure: { message: string | null } = { message: null }
  const done = await saveDashboard({
    editor: deps.editor,
    file,
    meta: deps.meta,
    onFail: () => {
      failure.message = file.conflict.value ?? file.error.value ?? '保存失败'
      toast.error(failure.message)
    },
  })
  if (done) toast.success('大屏已保存')
  return { isSaved: done, message: failure.message }
}

/** 草稿流与离开守卫装在本工厂：要的（编辑器/载荷/元数据/确认框）恰与这里的依赖重合。 */
function installDraftFlow(deps: EditorPageOpsDeps): void {
  useEditorDraftFlow({
    editor: deps.editor,
    dashboard: deps.file.dashboard,
    meta: deps.meta,
    restoreEditorSection: deps.arrange.restoreEditorSection,
    confirm: deps.confirm,
  })
}

export function createEditorPageOps(deps: EditorPageOpsDeps): EditorPageOps {
  const { editor, actions, meta, toast } = deps

  // 子编辑器入口挂在这里而不是页面上：它要的东西（选中、脏、保存、提示、路由参数）
  // 与本工厂完全重合，搬到页面上等于把同一批依赖再列一遍
  useSubEditorEntry({
    dashboardId: deps.dashboardId,
    selectedId: editor.selectedId,
    isDirty: () => editor.isDirty.value || meta.isDirty.value,
    save: () => save(deps),
    confirm: deps.confirm,
    toast,
  })

  installDraftFlow(deps)

  return {
    addModule: (manifest) => {
      if (!actions.addModule(manifest)) {
        toast.error('这类钉位模块每张大屏最多一个')
      }
    },
    removeNode: (nodeId) => removeNode(deps, nodeId),
    removeSelected: () => removeSelected(deps),
    reload: () => reload(deps),
    save: () => save(deps),
    changeSelectedGeometry: (geometry, isContinuous) => {
      const node = editor.selected.value
      if (node === null) return
      actions.changeGeometry(
        node.id,
        geometry,
        isContinuous,
        changedDimensionOf(node, geometry),
      )
    },
    toggleSelectedVisible: (isVisible) => {
      actions.setVisibleBatch(editor.selectedIds.value, isVisible)
    },
    pickPoint: (point) => {
      const fieldKey = deps.pickingFieldKey.value
      if (fieldKey !== null) actions.applyPickedPoint(fieldKey, point.node_key)
    },
    closePicker: (open) => {
      if (!open) deps.pickingFieldKey.value = null
    },
    consumePicker: () => {
      if (deps.pickingFieldKey.value === null) return false
      deps.pickingFieldKey.value = null
      return true
    },
  }
}
