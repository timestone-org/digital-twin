/** @fileoverview 层级图 useHierarchyProjects 的生命周期装配。 */
import { Controller, createState } from './hierarchyProjectsState'
import type { useHierarchySaving } from './useHierarchySaving'
export function useHierarchyProjects(
  saving: ReturnType<typeof useHierarchySaving>,
) {
  const state = createState(saving)
  const controller = new Controller(state)
  return {
    items: state.items,
    versions: state.versions,
    page: state.page,
    total: state.total,
    query: state.query,
    loading: state.loading,
    error: state.error,
    refresh: controller.refresh,
    search: controller.search,
    setQuery: controller.setQuery,
    goToPage: controller.goToPage,
    open: controller.open,
    reloadCurrent: controller.reloadCurrent,
    create: controller.create,
    remove: controller.remove,
    loadHistory: controller.loadHistory,
    restore: controller.restore,
  }
}
