/** @fileoverview 串行自动保存，保留并发冲突时的本地草稿。 */
import * as api from '@/api/hierarchy'
import type { HierarchyProject } from '@dt/contracts'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { validate } from './graph'
import { clone, signature } from './mutations'
import type { HierarchyEditor } from './useHierarchyDocument'

export function createState(editor: HierarchyEditor, canEdit: () => boolean) {
  const savedProject = shallowRef<HierarchyProject | null>(null)
  const projectId = ref(''),
    revision = ref(0),
    savedSignature = ref('')
  const saving = ref(false),
    error = ref('')
  const dirty = computed(
    () =>
      canEdit() &&
      (editor.hasDrafts.value ||
        (signature(editor.document.value) !== savedSignature.value &&
          editor.document.value !== null)),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const holder: { running: Promise<void> | null } = { running: null }
  const disposed = false
  return {
    savedProject,
    projectId,
    revision,
    savedSignature,
    saving,
    error,
    dirty,
    timer,
    holder,
    disposed,
    editor,
    canEdit,
  }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {
    watch(this.state.editor.document, () => {
      clearTimeout(this.state.timer)
      if (
        this.state.canEdit() &&
        this.state.dirty.value &&
        !this.state.error.value &&
        !this.state.saving.value
      )
        this.state.timer = setTimeout(() => {
          void this.flush().catch(() => undefined)
        }, 900)
    })
    onBeforeUnmount(() => {
      this.state.disposed = true
      clearTimeout(this.state.timer)
    })
  }
  install = (project: HierarchyProject) => {
    clearTimeout(this.state.timer)
    this.state.savedProject.value = project
    this.state.projectId.value = project.id
    this.state.revision.value = project.revision
    this.state.savedSignature.value = signature(project.document)
    this.state.editor.install(project.document)
    this.state.error.value = ''
  }
  writeChanges = async () => {
    this.state.saving.value = true
    try {
      while (
        !this.state.disposed &&
        this.state.editor.document.value &&
        signature(this.state.editor.document.value) !==
          this.state.savedSignature.value
      ) {
        const snapshot = validate(clone(this.state.editor.document.value))
        this.state.editor.commit(snapshot, false)
        const result = await api.saveProject(
          this.state.projectId.value,
          this.state.revision.value,
          snapshot,
        )
        if (this.state.disposed) return
        this.state.savedProject.value = result
        this.state.revision.value = result.revision
        this.state.savedSignature.value = signature(snapshot)
      }
      this.state.error.value = ''
    } catch (caught) {
      clearTimeout(this.state.timer)
      this.state.error.value =
        caught instanceof Error ? caught.message : '保存失败'
      throw caught
    } finally {
      if (!this.state.disposed) this.state.saving.value = false
    }
  }
  flush = async () => {
    clearTimeout(this.state.timer)
    if (!this.state.canEdit()) return
    this.state.editor.applyDrafts()
    if (this.state.holder.running) return this.state.holder.running
    this.state.holder.running = this.writeChanges().finally(() => {
      this.state.holder.running = null
    })
    return this.state.holder.running
  }
}
