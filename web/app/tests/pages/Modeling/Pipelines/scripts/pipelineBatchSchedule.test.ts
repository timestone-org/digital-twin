/** @fileoverview 批量定时的保留与统一策略、逐项修订和读取消保护。 */
import type { ModelingSchedule } from '@dt/contracts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import * as workflow from '@/api/modelingWorkflow'
import {
  disablePipelineSchedule,
  enablePipelineSchedule,
} from '@/pages/Modeling/Pipelines/scripts/pipelineBatchSchedule'
import type { PipelineBatchScheduleDraft } from '@/pages/Modeling/Pipelines/scripts/pipelineBatchSchedule'
import {
  ModelingBatchRejected,
  ModelingBatchSkipped,
  ModelingBatchStopped,
} from '@/pages/Modeling/scripts/modelingBatch'
import type { ModelingBatchContext } from '@/pages/Modeling/scripts/modelingBatch'

const DEFAULT: PipelineBatchScheduleDraft = {
  strategy: 'preserve',
  intervalMinutes: 1440,
  autoPublish: false,
}
function schedule(changes: Partial<ModelingSchedule> = {}): ModelingSchedule {
  return {
    pipeline_id: 'p1',
    is_enabled: false,
    interval_minutes: 30,
    auto_publish: true,
    next_run_at: null,
    last_run_at: null,
    last_run_id: null,
    last_error: null,
    revision: 6,
    updated_at: null,
    ...changes,
  }
}
function context(controller = new AbortController()): ModelingBatchContext {
  function ensureActive(): void {
    if (controller.signal.aborted) throw new ModelingBatchStopped('读取已取消')
  }
  return {
    async read<TResult>(
      load: (signal: AbortSignal) => Promise<TResult>,
    ): Promise<TResult> {
      ensureActive()
      const value = await load(controller.signal)
      ensureActive()
      return value
    },
    ensureActive,
    isActive: () => !controller.signal.aborted,
  }
}
beforeEach(() => {
  vi.spyOn(workflow, 'getModelingSchedule').mockResolvedValue(schedule())
  vi.spyOn(workflow, 'saveModelingSchedule').mockResolvedValue(
    schedule({ revision: 7 }),
  )
})
afterEach(() => vi.restoreAllMocks())
it('默认保留已有周期和自动发布，使用该项读取的修订号', async () => {
  await enablePipelineSchedule('p1', DEFAULT, context(), true)
  expect(workflow.getModelingSchedule).toHaveBeenCalledWith(
    'p1',
    expect.any(AbortSignal),
  )
  expect(workflow.saveModelingSchedule).toHaveBeenCalledWith('p1', {
    is_enabled: true,
    interval_minutes: 30,
    auto_publish: true,
    expected_revision: 6,
  })
})
it('只有未配置项采用下方默认值，不默认启用自动发布', async () => {
  vi.mocked(workflow.getModelingSchedule).mockResolvedValue(
    schedule({ revision: 0, interval_minutes: 60, auto_publish: false }),
  )
  await enablePipelineSchedule('p1', DEFAULT, context(), false)
  expect(workflow.saveModelingSchedule).toHaveBeenCalledWith('p1', {
    is_enabled: true,
    interval_minutes: 1440,
    auto_publish: false,
    expected_revision: 0,
  })
})
it('明确统一策略才覆盖已有配置', async () => {
  await enablePipelineSchedule(
    'p1',
    { strategy: 'replace', intervalMinutes: 60, autoPublish: false },
    context(),
    false,
  )
  expect(workflow.saveModelingSchedule).toHaveBeenCalledWith('p1', {
    is_enabled: true,
    interval_minutes: 60,
    auto_publish: false,
    expected_revision: 6,
  })
})
it.each(['preserve', 'replace'] as const)(
  '已启用且%s设置一致时跳过，保留下次执行时间',
  async (strategy) => {
    vi.mocked(workflow.getModelingSchedule).mockResolvedValue(
      schedule({ is_enabled: true, next_run_at: '2026-11-05T00:00:00Z' }),
    )
    await expect(
      enablePipelineSchedule(
        'p1',
        { strategy, intervalMinutes: 30, autoPublish: true },
        context(),
        true,
      ),
    ).rejects.toBeInstanceOf(ModelingBatchSkipped)
    expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
  },
)
it('无发布权限不会把已有自动发布强清为false', async () => {
  await expect(
    enablePipelineSchedule('p1', DEFAULT, context(), false),
  ).rejects.toBeInstanceOf(ModelingBatchRejected)
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
})
it('无发布权限也不能通过统一策略开启自动发布', async () => {
  await expect(
    enablePipelineSchedule(
      'p1',
      { ...DEFAULT, strategy: 'replace', autoPublish: true },
      context(),
      false,
    ),
  ).rejects.toBeInstanceOf(ModelingBatchRejected)
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
})
it('关闭规则保留每项周期及自动发布，不重置成默认值', async () => {
  vi.mocked(workflow.getModelingSchedule).mockResolvedValue(
    schedule({ is_enabled: true, interval_minutes: 120, revision: 11 }),
  )
  await disablePipelineSchedule('p1', context())
  expect(workflow.saveModelingSchedule).toHaveBeenCalledWith('p1', {
    is_enabled: false,
    interval_minutes: 120,
    auto_publish: true,
    expected_revision: 11,
  })
})
it('已关闭规则正常跳过，不创建空规则', async () => {
  vi.mocked(workflow.getModelingSchedule).mockResolvedValue(
    schedule({ revision: 0 }),
  )
  await expect(disablePipelineSchedule('p1', context())).rejects.toBeInstanceOf(
    ModelingBatchSkipped,
  )
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
})
it('修订冲突向调用方报告且不覆盖、不自动重试', async () => {
  const conflict = new BizError(41445, '规则已变更', 409, 'trace')
  vi.mocked(workflow.saveModelingSchedule).mockRejectedValue(conflict)
  await expect(
    enablePipelineSchedule('p1', DEFAULT, context(), true),
  ).rejects.toBe(conflict)
  expect(workflow.getModelingSchedule).toHaveBeenCalledOnce()
  expect(workflow.saveModelingSchedule).toHaveBeenCalledOnce()
})
it('读取失败不发送写请求', async () => {
  const failure = new TransportError(503, '读取不可用')
  vi.mocked(workflow.getModelingSchedule).mockRejectedValue(failure)
  await expect(disablePipelineSchedule('p1', context())).rejects.toBe(failure)
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
})
it('GET返回前取消批次时不发PUT', async () => {
  let complete: ((value: ModelingSchedule) => void) | undefined
  vi.mocked(workflow.getModelingSchedule).mockImplementation(
    () =>
      new Promise<ModelingSchedule>((resolve) => {
        complete = resolve
      }),
  )
  const controller = new AbortController()
  const pending = enablePipelineSchedule(
    'p1',
    DEFAULT,
    context(controller),
    true,
  )
  controller.abort()
  complete?.(schedule())
  await expect(pending).rejects.toBeInstanceOf(ModelingBatchStopped)
  expect(workflow.saveModelingSchedule).not.toHaveBeenCalled()
})
