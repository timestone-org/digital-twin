/** @fileoverview 回看历史前确认是否放弃未保存的画布。 */
import { useConfirm } from '@dt/ui'

/** 已保存或正在回看时直接放行，否则由用户确认放弃草稿。 */
export async function confirmReplay(
  isDirty: boolean,
  isReplaying: boolean,
): Promise<boolean> {
  if (!isDirty || isReplaying) return true
  return useConfirm().ask({
    title: '放弃未保存的画布？',
    message: '回看历史运行会替换当前画布，未保存的修改将丢失。可取消并先保存。',
    confirmText: '放弃修改并回看',
    cancelText: '保留修改',
    danger: true,
  })
}
