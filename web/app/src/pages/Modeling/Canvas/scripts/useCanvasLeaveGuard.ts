/** @fileoverview 建模画布的站内离开与关页保护。 */
import { useConfirm } from '@dt/ui'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

import { useUnsavedGuard } from '@/composables/useUnsavedGuard'

/** 未保存的图只在内存中；取消离开时保留当前画布和撤销栈。 */
export function useCanvasLeaveGuard(
  isDirty: () => boolean,
  onLeave: () => void,
): void {
  const confirm = useConfirm()
  useUnsavedGuard(isDirty)
  async function allowLeaving(): Promise<boolean> {
    if (
      isDirty() &&
      !(await confirm.ask({
        title: '放弃未保存的画布？',
        message: '流水线有未保存的修改，离开会丢失。可取消并先保存。',
        confirmText: '放弃修改并离开',
        cancelText: '保留修改',
        danger: true,
      }))
    )
      return false
    onLeave()
    return true
  }
  onBeforeRouteLeave(allowLeaving)
  onBeforeRouteUpdate((to, from) =>
    to.params['pipelineId'] === from.params['pipelineId']
      ? true
      : allowLeaving(),
  )
}
