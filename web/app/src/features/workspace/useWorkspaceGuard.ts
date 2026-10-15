/** @fileoverview 缓存页切换保留草稿，关闭页签或真正离开时执行原有确认。 */
import { onBeforeUnmount, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useWorkspace, useWorkspacePage } from './context'

export function useWorkspaceDirty(isDirty: () => boolean): void {
  const workspace = useWorkspace()
  const page = useWorkspacePage()
  if (workspace === null || page === null) return
  watch(isDirty, (dirty) => workspace.update(page.key, { dirty }), {
    immediate: true,
    flush: 'sync',
  })
}

export function useWorkspaceGuard(
  guard: () => boolean | Promise<boolean>,
  changed: (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
  ) => boolean = () => true,
): void {
  const workspace = useWorkspace()
  const page = useWorkspacePage()
  if (workspace !== null && page !== null) {
    onBeforeUnmount(workspace.registerGuard(page.key, guard))
  }
  function leave(to: RouteLocationNormalized): boolean | Promise<boolean> {
    if (page?.cached === true && workspace?.canRetain(to) === true) return true
    return guard()
  }
  onBeforeRouteLeave(leave)
  onBeforeRouteUpdate((to, from) => (changed(to, from) ? leave(to) : true))
}
