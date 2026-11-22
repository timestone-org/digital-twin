/** @fileoverview 层级图页面编排与离开保护。 */
import { useAuthStore } from '@/stores/auth'
import { PERMISSION_CODES } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { computed, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { blank, clone, signature, drawingSignature } from './mutations'
import { SAMPLE } from './sample'
import type { Drawing, ExportFormat } from './types'
import { useHierarchyCompute } from './useHierarchyCompute'
import { useHierarchyDocument } from './useHierarchyDocument'
import { useHierarchyFiles } from './useHierarchyFiles'
import {
  savingStatus,
  useHierarchyPageLifecycle,
} from './useHierarchyPageLifecycle'
import { useHierarchyProjects } from './useHierarchyProjects'
import { useHierarchySaving } from './useHierarchySaving'

export function createState() {
  const auth = useAuthStore(),
    toast = useToast(),
    confirm = useConfirm()
  const canEdit = computed(() => auth.can([PERMISSION_CODES.hierarchyManage]))
  const editor = useHierarchyDocument(),
    saving = useHierarchySaving(editor, () => canEdit.value)
  const projects = useHierarchyProjects(saving),
    compute = useHierarchyCompute(),
    files = useHierarchyFiles(compute)
  const lifecycle = useHierarchyPageLifecycle(projects, saving, confirm)
  const mode = ref('edit'),
    drawing = shallowRef<Drawing | null>(null),
    drawnSignature = ref('')
  const isHistoryOpen = ref(false),
    isNewOpen = ref(false),
    newTitle = ref('未命名层级图'),
    useSample = ref(false)
  const busy = computed(
    () => projects.loading.value || compute.busy.value || files.busy.value,
  )
  const status = savingStatus(saving, editor)
  return {
    ...lifecycle,
    toast,
    confirm,
    canEdit,
    editor,
    saving,
    projects,
    compute,
    files,
    mode,
    drawing,
    drawnSignature,
    isHistoryOpen,
    isNewOpen,
    newTitle,
    useSample,
    busy,
    status,
    outdated: previewOutdated(drawing, drawnSignature, editor),
  }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {}

  safe = async (action: () => Promise<unknown> | void) => {
    try {
      await action()
    } catch (error) {
      this.state.toast.error(
        error instanceof Error ? error.message : '操作失败',
      )
    }
  }
  reload = async () => {
    const confirmed = await this.state.confirm.ask({
      title: '重新加载服务器版本？',
      message: '本地未保存修改将被替换。需要保留时，请先导出 JSON 配置。',
      confirmText: '重新加载',
      cancelText: '保留草稿',
      danger: true,
    })
    if (!confirmed) return
    await this.state.projects.reloadCurrent()
    this.state.mode.value = 'edit'
    this.state.drawing.value = null
  }
  open = async (id: string) => {
    await this.state.projects.open(id)
    this.state.mode.value = 'edit'
    this.state.drawing.value = null
  }
  create = async () => {
    const document = this.state.useSample.value
      ? clone(SAMPLE)
      : blank(this.state.newTitle.value)
    document.title = this.state.newTitle.value
    await this.state.projects.create(document)
    this.state.isNewOpen.value = false
    this.state.mode.value = 'edit'
    this.state.drawing.value = null
  }
  duplicate = async () => {
    this.state.editor.applyDrafts()
    const document = this.state.editor.document.value
    if (!document) return
    await this.state.projects.create({
      ...clone(document),
      title: `${document.title.slice(0, 75)} · 副本`,
    })
    this.state.mode.value = 'edit'
  }
  remove = async () => {
    if (!(await this.state.projects.remove())) return
    this.state.editor.document.value = null
    this.state.saving.projectId.value = ''
    this.state.drawing.value = null
    const first = this.state.projects.items.value[0]
    if (first) await this.state.projects.open(first.id)
  }
  arrange = async () => {
    this.state.editor.applyDrafts()
    const document = this.state.editor.document.value
    if (!document) return
    const before = signature(document),
      result = await this.state.compute.run({
        action: 'arrange',
        document: clone(document),
      })
    if (before !== signature(this.state.editor.document.value)) {
      this.state.toast.warning('整理期间配置已变化，请重新整理')
      return
    }
    const current = this.state.editor.document.value
    if (result?.kind === 'document' && current)
      this.state.editor.commit({
        ...result.document,
        viewport: current.viewport,
      })
  }
  draw = async () => {
    this.state.editor.applyDrafts()
    const document = this.state.editor.document.value
    if (!document) return
    const before = drawingSignature(document),
      result = await this.state.compute.run({
        action: 'draw',
        document: clone(document),
      })
    if (before !== drawingSignature(this.state.editor.document.value)) return
    if (result?.kind === 'drawing') {
      this.state.drawing.value = result.drawing
      this.state.drawnSignature.value = before
      this.state.mode.value = 'drawing'
    }
  }
  exportFile = async (format: ExportFormat) => {
    this.state.editor.applyDrafts()
    if (this.state.editor.document.value)
      await this.state.files.exportFile(
        format,
        clone(this.state.editor.document.value),
      )
  }
  importFiles = async (selected: File[]) => {
    const file = selected[0]
    if (!file) return
    const document = await this.state.files.importFile(file)
    if (document) {
      await this.state.projects.create(document)
      this.state.mode.value = 'edit'
      this.state.drawing.value = null
    }
  }
  history = async () => {
    await this.state.saving.flush()
    await this.state.projects.loadHistory()
    this.state.isHistoryOpen.value = true
  }
}

function previewOutdated(
  drawing: ShallowRef<Drawing | null>,
  drawnSignature: Ref<string>,
  editor: ReturnType<typeof useHierarchyDocument>,
) {
  return computed(
    () =>
      drawing.value !== null &&
      drawnSignature.value !== drawingSignature(editor.document.value),
  )
}
