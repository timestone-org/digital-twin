/** @fileoverview 当前页训练记录的串行批量取消与删除。 */
import type { ModelingRunSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection } from '@dt/ui'
import { computed } from 'vue'
import * as modeling from '@/api/modeling'
import { deleteModelingRun } from '@/api/modelingWorkflow'
import { useAuthStore } from '@/stores/auth'
import { useModelingBatch } from '../../scripts/useModelingBatch'
import type { ModelingBatchAction } from '../../scripts/modelingBatch'

function buildDeletion(): ModelingBatchAction<ModelingRunSummary> {
  return {
    label: '批量删除训练记录',
    message:
      '永久删除选中训练的配置快照、节点结果和未引用模型。正在训练、正在发布的记录将跳过；被部署、公式或切换历史引用的记录由服务端保护。',
    danger: true,
    skip: (row) =>
      !['succeeded', 'failed', 'cancelled'].includes(row.status)
        ? '训练仍在进行，请先取消并等待结束'
        : row.publication_status === 'pending'
          ? '正在发布模型，请等待发布结束'
          : null,
    action: (row) => deleteModelingRun(row.id),
  }
}

function buildCancellation(): ModelingBatchAction<ModelingRunSummary> {
  return {
    label: '批量取消训练',
    message:
      '请求取消选中的排队或运行中训练。取消将在算子边界生效，已经结束或正在取消的记录将跳过。',
    danger: true,
    skip: (row) =>
      ['pending', 'running'].includes(row.status)
        ? null
        : '训练已结束或正在取消',
    action: (row) => modeling.cancelModelingRun(row.id),
  }
}

export function useRunBatch(
  rows: () => readonly ModelingRunSummary[],
  scope: () => string,
  onDone: () => Promise<void>,
  isDisabled: () => boolean,
) {
  const auth = useAuthStore()
  const canRemove = computed(() => auth.can([PERMISSION_CODES.modelingPublish]))
  const canCancel = computed(() => auth.can([PERMISSION_CODES.modelingRun]))
  const batch = useModelingBatch(
    rows,
    (row) => `训练 ${row.id}`,
    () => `${scope()}:${canRemove.value}:${canCancel.value}`,
  )
  const selection = computed<
    DtDataViewSelection<ModelingRunSummary> | undefined
  >(() =>
    canRemove.value || canCancel.value
      ? {
          selectedIds: batch.selectedIds.value,
          disabled: batch.isBusy.value || isDisabled(),
          rowLabel: (row) => `训练 ${row.id}`,
        }
      : undefined,
  )
  async function remove(): Promise<void> {
    if (!canRemove.value || isDisabled()) return
    const report = await batch.run(buildDeletion())
    if (report !== null) await onDone()
  }
  async function cancel(): Promise<void> {
    if (!canCancel.value || isDisabled()) return
    const report = await batch.run(buildCancellation())
    if (report !== null) await onDone()
  }
  return { batch, selection, canRemove, canCancel, remove, cancel }
}
