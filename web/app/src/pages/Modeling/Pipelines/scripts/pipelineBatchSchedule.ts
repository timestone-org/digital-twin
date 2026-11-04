/** @fileoverview 批量定时规则沿用每项修订号，关闭时保留原有周期与发布配置。 */
import {
  getModelingSchedule,
  saveModelingSchedule,
} from '@/api/modelingWorkflow'
import {
  ModelingBatchRejected,
  ModelingBatchSkipped,
} from '../../scripts/modelingBatch'
import type { ModelingBatchContext } from '../../scripts/modelingBatch'

export interface PipelineBatchScheduleDraft {
  strategy: 'preserve' | 'replace'
  intervalMinutes: number
  autoPublish: boolean
}

export async function enablePipelineSchedule(
  pipelineId: string,
  draft: PipelineBatchScheduleDraft,
  context: ModelingBatchContext,
  canPublish: boolean,
): Promise<unknown> {
  const current = await context.read((signal) =>
    getModelingSchedule(pipelineId, signal),
  )
  const preserve = draft.strategy === 'preserve' && current.revision > 0
  const interval = preserve ? current.interval_minutes : draft.intervalMinutes
  const autoPublish = preserve ? current.auto_publish : draft.autoPublish
  if (
    current.is_enabled &&
    current.interval_minutes === interval &&
    current.auto_publish === autoPublish
  ) {
    throw new ModelingBatchSkipped(
      '定时训练已开启且配置一致，保留当前下次训练时间',
    )
  }
  if (autoPublish && !canPublish)
    throw new ModelingBatchRejected('开启此自动发布规则需要模型发布权限')
  context.ensureActive()
  return saveModelingSchedule(pipelineId, {
    is_enabled: true,
    interval_minutes: interval,
    auto_publish: autoPublish,
    expected_revision: current.revision,
  })
}

export async function disablePipelineSchedule(
  pipelineId: string,
  context: ModelingBatchContext,
): Promise<unknown> {
  const current = await context.read((signal) =>
    getModelingSchedule(pipelineId, signal),
  )
  if (!current.is_enabled) throw new ModelingBatchSkipped('定时训练已关闭')
  context.ensureActive()
  return saveModelingSchedule(pipelineId, {
    is_enabled: false,
    interval_minutes: current.interval_minutes,
    auto_publish: current.auto_publish,
    expected_revision: current.revision,
  })
}
