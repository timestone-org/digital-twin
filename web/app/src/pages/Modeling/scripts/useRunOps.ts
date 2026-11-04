/** @fileoverview 训练模型的直接发布和训练记录清理。 */
import type { ModelingRunSummary } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { onBeforeUnmount, ref } from 'vue'
import type { Ref } from 'vue'
import { deleteModelingRun, deployModelingRun } from '@/api/modelingWorkflow'
import { describeError } from '@/composables/useAsyncList'
import { BizError } from '@/api/client'

interface ActionState {
  busyId: Ref<string>
  confirm: ReturnType<typeof useConfirm>
  toast: ReturnType<typeof useToast>
  isDisposed: () => boolean
  onDone: () => void
}
async function deployWithConfirmation(runId: string, state: ActionState) {
  try {
    return await deployModelingRun(runId)
  } catch (caught) {
    if (!(caught instanceof BizError) || caught.code !== 41435) throw caught
    if (state.isDisposed()) return null
    const accepted = await state.confirm.ask({
      title: '新模型的调用格式有变化',
      message:
        '输入字段或输出格式与当前发布模型不同。发布后，原有调用方可能需要调整参数。确认调用方已适配后再继续。',
      confirmText: '已确认格式变化，继续发布',
      danger: true,
    })
    if (!accepted || state.isDisposed()) return null
    return deployModelingRun(runId, true)
  }
}
async function publish(runId: string, state: ActionState): Promise<void> {
  if (state.busyId.value || state.isDisposed()) return
  const accepted = await state.confirm.ask({
    title: '发布这次训练的模型？',
    message:
      '此工作流的固定调用入口将切换到本次模型；训练记录和历史模型继续保留，公式绑定保持原版本。发布校验失败时继续使用当前模型。',
    confirmText: '发布模型',
  })
  if (!accepted || state.isDisposed()) return
  state.busyId.value = runId
  try {
    const deployed = await deployWithConfirmation(runId, state)
    if (deployed === null || state.isDisposed()) return
    state.toast.success(`模型已发布，调用编码：${deployed.code}`)
    state.onDone()
  } catch (caught) {
    if (!state.isDisposed()) state.toast.error(describeError(caught))
  } finally {
    if (!state.isDisposed()) state.busyId.value = ''
  }
}
async function remove(
  row: ModelingRunSummary,
  state: ActionState,
): Promise<void> {
  if (state.busyId.value || state.isDisposed()) return
  const accepted = await state.confirm.ask({
    title: '删除这次训练记录？',
    message:
      '将删除本次训练的配置快照、结果和未被引用的模型，操作无法撤销。正在训练、已部署、绑定公式或用于切换历史的模型会受到保护。',
    confirmText: '删除训练记录',
    danger: true,
  })
  if (!accepted || state.isDisposed()) return
  state.busyId.value = row.id
  try {
    await deleteModelingRun(row.id)
    if (state.isDisposed()) return
    state.toast.success('训练记录已删除')
    state.onDone()
  } catch (caught) {
    if (!state.isDisposed()) state.toast.error(describeError(caught))
  } finally {
    if (!state.isDisposed()) state.busyId.value = ''
  }
}
export function useRunOps(onDone: () => void) {
  let isDisposed = false
  onBeforeUnmount(() => {
    isDisposed = true
  })
  const state: ActionState = {
    busyId: ref(''),
    confirm: useConfirm(),
    toast: useToast(),
    isDisposed: () => isDisposed,
    onDone,
  }
  return {
    busyId: state.busyId,
    publish: (runId: string) => publish(runId, state),
    remove: (row: ModelingRunSummary) => remove(row, state),
  }
}
