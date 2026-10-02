/** @fileoverview 模型服务删除回执只在实际成功时显示，取消不发请求。 */
import type { ModelDeployment } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import { useDeploymentOps } from '@/pages/Modeling/Services/scripts/useDeploymentOps'

const DEPLOYMENT: ModelDeployment = {
  id: 'd1',
  code: 'test-model',
  model_version_id: 'v1',
  model_name: '测试模型',
  model_version: 1,
  name: '测试服务',
  description: null,
  is_enabled: true,
  is_servable: true,
  unservable_reason: null,
  max_rows_per_call: 200,
  rate_limit_per_minute: 60,
  key_count: 0,
  created_by_name: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

afterEach(() => {
  useConfirm().resolve(false)
  useToast().clear()
  vi.restoreAllMocks()
})

describe('模型服务删除', () => {
  it('失败时只显示错误并保留列表', async () => {
    vi.spyOn(modeling, 'deleteModelDeployment').mockRejectedValue(
      new Error('offline'),
    )
    const onDone = vi.fn()
    const ops = useDeploymentOps(onDone)
    const removing = ops.remove(DEPLOYMENT)
    useConfirm().resolve(true)
    await removing
    expect(useToast().toasts.value.map((toast) => toast.intent)).toEqual([
      'danger',
    ])
    expect(onDone).not.toHaveBeenCalled()
    expect(ops.isBusy.value).toBe(false)
  })

  it('成功的无内容响应显示成功并刷新列表', async () => {
    vi.spyOn(modeling, 'deleteModelDeployment').mockResolvedValue(undefined)
    const onDone = vi.fn()
    const ops = useDeploymentOps(onDone)
    const removing = ops.remove(DEPLOYMENT)
    useConfirm().resolve(true)
    await removing
    expect(useToast().toasts.value.map((toast) => toast.message)).toEqual([
      '已删除',
    ])
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('取消确认时不删除也不显示成功', async () => {
    const remove = vi.spyOn(modeling, 'deleteModelDeployment')
    const onDone = vi.fn()
    const ops = useDeploymentOps(onDone)
    const removing = ops.remove(DEPLOYMENT)
    useConfirm().resolve(false)
    await removing
    expect(remove).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(useToast().toasts.value).toEqual([])
  })
})
