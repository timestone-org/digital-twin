/** @fileoverview 大屏与子编辑器页签的资源名称、保存版本联动。 */
import { watch } from 'vue'
import type { DashboardPayload } from '@dt/contracts'
import { useWorkspace, useWorkspacePage } from './context'

export function useWorkspaceDashboard(
  dashboard: () => DashboardPayload | null,
): void {
  const workspace = useWorkspace()
  const page = useWorkspacePage()
  if (workspace === null || page === null) return
  watch(
    dashboard,
    (current) => {
      if (current === null) return
      const tab = workspace.tabs.value.find((entry) => entry.key === page.key)
      if (tab === undefined) return
      const nodeId = tab.route.params['nodeId']
      const node = current.nodes.find((entry) => entry.id === nodeId)
      const label = node?.configJson['__label']
      const detail =
        typeof label === 'string' && label.trim() !== ''
          ? label
          : tab.route.meta.title
      const title =
        tab.route.name === 'dashboard-editor'
          ? `${current.name} · 编辑`
          : `${current.name} · ${detail ?? '页面'}`
      workspace.update(page.key, { title })
      workspace.recordDashboard(current.id, current.rowVersion, page.key)
    },
    { immediate: true },
  )
}
