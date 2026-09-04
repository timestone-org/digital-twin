/**
 * @fileoverview 把实时点位与序列取数接进编辑器：订阅跟着当前大屏的 topic 走，
 * 大屏一换订阅跟着换。设计态与运行态用的是同一套数据源，预览才不会两套观感。
 *
 * ⚠ 只接取数不接刷新节拍：编辑一格的时候，屏上不该有东西在背后自己刷新
 * （docs/DASHBOARD_CHART_MODULES_DESIGN.md §4.3 D8）。
 */
import type { DashboardNodeView, DashboardPayload } from '@dt/contracts'
import type { Ref } from 'vue'

import { fetchPointHistory } from '@/api/pointHistories'
import {
  installDashboardDataSources,
  installDashboardSeries,
} from '@/bootstrap/dashboard'
import {
  useDashboardValues,
  type DashboardValues,
} from '@/composables/useDashboardValues'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'
import { fetchDatasetSeries } from '@/runtime/seriesReader'

/**
 * @param dashboard 当前大屏；没加载出来时不订阅任何 topic
 * @param nodes 当前节点表，取数按它上面的绑定展开
 */
export function useEditorDataSources(
  dashboard: Ref<DashboardPayload | null>,
  nodes: () => readonly DashboardNodeView[],
): DashboardValues {
  installDashboardDataSources({
    subscribe: createPointSubscribe(useRealtimeChannel(), () => {
      const current = dashboard.value
      return current === null ? null : dashboardTopic(current.id)
    }),
    fetchHistory: fetchPointHistory,
    fetchDatasetSeries,
  })
  const values = useDashboardValues(nodes, () => dashboard.value?.id ?? '')
  // ⚠ 必须排在 `useDashboardValues` 之后：两次注入的是同一个键，后者整份覆盖前者
  installDashboardSeries({ readPoint: values.read })
  return values
}
