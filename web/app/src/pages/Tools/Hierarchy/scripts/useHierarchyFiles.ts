/** @fileoverview 层级图 useHierarchyFiles 的生命周期装配。 */
import { Controller, createState } from './hierarchyFilesState'
import type { useHierarchyCompute } from './useHierarchyCompute'
export function useHierarchyFiles(
  compute: ReturnType<typeof useHierarchyCompute>,
) {
  const state = createState(compute)
  const controller = new Controller(state)
  return {
    busy: state.busy,
    importFile: controller.importFile,
    exportFile: controller.exportFile,
  }
}
