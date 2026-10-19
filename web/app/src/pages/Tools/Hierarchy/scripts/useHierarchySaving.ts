/** @fileoverview 层级图 useHierarchySaving 的生命周期装配。 */
import { Controller, createState } from './hierarchySavingState'
import type { HierarchyEditor } from './useHierarchyDocument'
export function useHierarchySaving(
  editor: HierarchyEditor,
  canEdit: () => boolean,
) {
  const state = createState(editor, canEdit)
  const controller = new Controller(state)
  return {
    savedProject: state.savedProject,
    projectId: state.projectId,
    revision: state.revision,
    dirty: state.dirty,
    saving: state.saving,
    error: state.error,
    install: controller.install,
    flush: controller.flush,
  }
}
