/** @fileoverview 层级图 useHierarchyCompute 的生命周期装配。 */
import { Controller, createState } from './hierarchyComputeState'
export function useHierarchyCompute() {
  const state = createState()
  const controller = new Controller(state)
  return {
    run: controller.run,
    busy: state.busy,
    error: state.error,
    issues: state.issues,
    cancel: state.request.cancel,
  }
}
