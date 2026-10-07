/** @fileoverview 大屏子编辑器离开或复用当前路由切换资源前的草稿确认。 */
import { useConfirm } from '@dt/ui'
import type { DtConfirmRequest } from '@dt/ui'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

/**
 * 资源参数更新也必须先确认，取消时路由和草稿保持原样。
 * @param isDirty 当前资源是否有未保存草稿
 * @param request 页面对应的离开确认文案
 */
export function useSubEditorRouteGuard(
  isDirty: () => boolean,
  request: DtConfirmRequest,
): void {
  const confirm = useConfirm()
  const leave = () => (isDirty() ? confirm.ask(request) : true)
  onBeforeRouteLeave(leave)
  onBeforeRouteUpdate((to, from) => {
    const resourceChanged =
      to.params.dashboardId !== from.params.dashboardId ||
      to.params.nodeId !== from.params.nodeId
    return resourceChanged ? leave() : true
  })
}
