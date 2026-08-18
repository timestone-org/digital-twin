/**
 * @fileoverview 把实时点位与历史取数接进编辑器：订阅跟着当前大屏的 topic 走，
 * 大屏一换订阅跟着换。设计态与运行态用的是同一套数据源，预览才不会两套观感。
 */
import type { DashboardNodeView, DashboardPayload } from '@dt/contracts'
import type { Ref } from 'vue'

import { fetchPointHistory } from '@/api/pointHistories'
import { installDashboardDataSources } from '@/bootstrap/dashboard'
import { useDashboardValues } from '@/composables/useDashboardValues'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'

/**
 * @param dashboard 当前大屏；没加载出来时不订阅任何 topic
 * @param nodes 当前节点表，取数按它上面的绑定展开
 */
export function useEditorDataSources(
  dashboard: Ref<DashboardPayload | null>,
  nodes: () => readonly DashboardNodeView[],
): void {
  installDashboardDataSources({
    subscribe: createPointSubscribe(useRealtimeChannel(), () => {
      const current = dashboard.value
      return current === null ? null : dashboardTopic(current.id)
    }),
    fetchHistory: fetchPointHistory,
  })
  useDashboardValues(nodes)
}
