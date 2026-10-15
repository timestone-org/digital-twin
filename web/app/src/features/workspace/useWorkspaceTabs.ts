/** @fileoverview 页签会话与当前账号、路由及权限生命周期的装配。 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { isAllowed } from '@dt/security'
import { useToast } from '@dt/ui'
import type { Router } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useEmbedContext } from '@/features/embed/context'
import type { Workspace } from './context'
import { WorkspaceTabs } from './workspaceTabs'

export function useWorkspaceTabs(router: Router): Workspace {
  const auth = useAuthStore()
  const embed = useEmbedContext()
  const toast = useToast()
  const enabled = computed(
    () => auth.isAuthenticated && !embed.isEmbedded.value,
  )
  const workspace = new WorkspaceTabs(router, {
    enabled,
    canAccess: (route) =>
      isAllowed(
        auth.permissions,
        route.meta.permissions ?? [],
        route.meta.permissionMode,
      ),
    reportError: (message) => toast.error(message),
  })
  watch([enabled, () => auth.user?.id], () => workspace.reset(), {
    flush: 'sync',
  })
  watch(
    () => auth.permissions,
    () => workspace.prune(),
  )
  watch(
    [router.currentRoute, enabled, () => auth.user?.id],
    () => workspace.visit(),
    { immediate: true, flush: 'sync' },
  )
  onBeforeUnmount(() => workspace.reset())
  return workspace
}
