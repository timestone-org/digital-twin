/** @fileoverview 工作流的批量训练、定时启停和受保护删除。 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataViewSelection } from '@dt/ui'
import { computed } from 'vue'
import { deleteModelingPipeline, startModelingRun } from '@/api/modeling'
import { useAuthStore } from '@/stores/auth'
import { useModelingBatch } from '../../scripts/useModelingBatch'
import type { ModelingBatchAction } from '../../scripts/modelingBatch'
import {
  disablePipelineSchedule,
  enablePipelineSchedule,
} from './pipelineBatchSchedule'
import type { PipelineBatchScheduleDraft } from './pipelineBatchSchedule'

function buildDeletion(): ModelingBatchAction<ModelingPipelineSummary> {
  return {
    label: '批量删除工作流',
    message:
      '永久删除所选工作流及其训练历史，无法撤销。正在训练、等待发布或被模板、实例、模型版本引用的工作流会保留并报告原因。',
    danger: true,
    action: (row) => deleteModelingPipeline(row.id),
  }
}

function buildTraining(): ModelingBatchAction<ModelingPipelineSummary> {
  return {
    label: '批量提交训练',
    message:
      '逐个提交选中工作流的训练请求，不自动发布。成功仅表示请求已提交，可在训练记录查看进度；已有在途训练的工作流会由服务端拒绝。',
    action: (row) => startModelingRun(row.id),
  }
}

function buildDisableSchedule(): ModelingBatchAction<ModelingPipelineSummary> {
  return {
    label: '批量关闭定时训练',
    message:
      '关闭所选工作流的定时训练，保留每项原有周期和自动发布设置；不会取消已经在执行的训练。',
    danger: true,
    action: (row, context) => disablePipelineSchedule(row.id, context),
  }
}

function buildEnableSchedule(
  draft: PipelineBatchScheduleDraft,
  canPublish: boolean,
): ModelingBatchAction<ModelingPipelineSummary> {
  return {
    label: '批量开启定时训练',
    message: '',
    isConfirmed: true,
    action: (row, context) =>
      enablePipelineSchedule(row.id, draft, context, canPublish),
  }
}

function usePipelineSelection(
  rows: () => readonly ModelingPipelineSummary[],
  scope: () => string,
  isDisabled: () => boolean,
) {
  const auth = useAuthStore()
  const canTrain = computed(() => auth.can([PERMISSION_CODES.modelingRun]))
  const canManage = computed(() => auth.can([PERMISSION_CODES.modelingManage]))
  const canPublish = computed(() =>
    auth.can([PERMISSION_CODES.modelingPublish]),
  )
  const batch = useModelingBatch(
    rows,
    (row) => row.name,
    () => `${scope()}:${canTrain.value}:${canManage.value}:${canPublish.value}`,
  )
  const canAct = computed(() => batch.canRun.value && !isDisabled())
  const selection = computed<
    DtDataViewSelection<ModelingPipelineSummary> | undefined
  >(() =>
    canTrain.value || canManage.value
      ? {
          selectedIds: batch.selectedIds.value,
          disabled: batch.isBusy.value || isDisabled(),
          selectAllLabel: '选择当前筛选结果',
          rowLabel: (row) => `工作流 ${row.name}`,
        }
      : undefined,
  )

  return { batch, canTrain, canManage, canPublish, canAct, selection }
}

export function usePipelineBatch(
  rows: () => readonly ModelingPipelineSummary[],
  scope: () => string,
  onDone: () => Promise<void>,
  isDisabled: () => boolean,
) {
  const state = usePipelineSelection(rows, scope, isDisabled)
  async function remove(): Promise<void> {
    if (!state.canManage.value || isDisabled()) return
    const report = await state.batch.run(buildDeletion())
    if (report !== null) await onDone()
  }
  async function train(): Promise<void> {
    if (!state.canTrain.value || isDisabled()) return
    const report = await state.batch.run(buildTraining())
    if (report !== null) await onDone()
  }
  async function disableSchedules(): Promise<void> {
    if (!state.canTrain.value || isDisabled()) return
    const report = await state.batch.run(buildDisableSchedule())
    if (report !== null) await onDone()
  }
  async function enableSchedules(draft: PipelineBatchScheduleDraft) {
    if (!state.canTrain.value || isDisabled()) return null
    const report = await state.batch.run(
      buildEnableSchedule(draft, state.canPublish.value),
    )
    if (report !== null) await onDone()
    return report
  }
  return {
    ...state,
    remove,
    train,
    disableSchedules,
    enableSchedules,
  }
}
