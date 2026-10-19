/** @fileoverview 层级图 useHierarchyPage 的生命周期装配。 */
import { Controller, createState } from './hierarchyPageState'
export function useHierarchyPage() {
  const state = createState()
  const controller = new Controller(state)
  return {
    editor: state.editor,
    saving: state.saving,
    projects: state.projects,
    compute: state.compute,
    canEdit: state.canEdit,
    available: state.available,
    checking: state.checking,
    availabilityError: state.availabilityError,
    mode: state.mode,
    drawing: state.drawing,
    busy: state.busy,
    status: state.status,
    outdated: state.outdated,
    isHistoryOpen: state.isHistoryOpen,
    isNewOpen: state.isNewOpen,
    newTitle: state.newTitle,
    useSample: state.useSample,
    safe: controller.safe,
    initialize: controller.initialize,
    open: controller.open,
    reload: controller.reload,
    create: controller.create,
    duplicate: controller.duplicate,
    remove: controller.remove,
    arrange: controller.arrange,
    draw: controller.draw,
    exportFile: controller.exportFile,
    importFiles: controller.importFiles,
    history: controller.history,
  }
}
