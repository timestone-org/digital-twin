/** @fileoverview 工作流训练、定时规则、模板创建及清理请求契约。 */
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingWorkflow'
import { startModelingRun } from '@/api/modeling'
import { request, requestData } from '@/api/client'
vi.mock('@/api/client', () => ({
  request: vi.fn().mockResolvedValue(undefined),
  requestData: vi.fn().mockResolvedValue({}),
}))
beforeEach(() => vi.clearAllMocks())
it('训练并发布向服务端提交完整意图与幂等键', async () => {
  await startModelingRun('p1', 'manual', false, true)
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-pipelines/p1:run',
    expect.objectContaining({
      method: 'POST',
      body: { trigger: 'manual', is_keeping_frames: false, auto_publish: true },
      headers: { 'Idempotency-Key': expect.any(String) },
    }),
  )
})
it('读取周期规则携带取消信号，保存携带修订号', async () => {
  const signal = new AbortController().signal
  await api.getModelingSchedule('p1', signal)
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-pipelines/p1/schedule',
    { baseUrl: '/api/v1/platform', signal },
  )
  const body = {
    is_enabled: true,
    interval_minutes: 1440,
    auto_publish: false,
    expected_revision: 2,
  }
  await api.saveModelingSchedule('p1', body)
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-pipelines/p1/schedule',
    expect.objectContaining({ method: 'PUT', body }),
  )
})
it('直接发布与模板创建均携带独立幂等键', async () => {
  await api.deployModelingRun('r1')
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-runs/r1:deploy',
    expect.objectContaining({
      method: 'POST',
      body: { is_signature_change_confirmed: false },
    }),
  )
  await api.deployModelingRun('r1', true)
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-runs/r1:deploy',
    expect.objectContaining({ body: { is_signature_change_confirmed: true } }),
  )
  await api.createWorkflowFromTemplate('t1', { code: 'energy', name: '能耗' })
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-templates/t1:create-workflow',
    expect.objectContaining({
      method: 'POST',
      body: { code: 'energy', name: '能耗' },
    }),
  )
  const keys = vi
    .mocked(requestData)
    .mock.calls.map(([, options]) =>
      new Headers(options?.headers).get('Idempotency-Key'),
    )
  expect(new Set(keys).size).toBe(3)
  expect(keys.every(Boolean)).toBe(true)
})
it('记录与模型清理接受204响应，不读取信封data', async () => {
  await api.deleteModelingRun('r1')
  expect(request).toHaveBeenLastCalledWith(
    '/modeling-runs/r1',
    expect.objectContaining({ method: 'DELETE' }),
  )
  await api.deleteModelingVersion('v1')
  expect(request).toHaveBeenLastCalledWith(
    '/modeling-model-versions/v1',
    expect.objectContaining({ method: 'DELETE' }),
  )
})
