/** @fileoverview 数据源表单写请求单飞，失败后保留表单并允许显式重提。 */
import type { CollectSource, CollectSourceCreateInput } from '@dt/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as collectApi from '@/api/collect'
import { useSourceOps } from '@/pages/Collect/Opcua/scripts/useSourceOps'

const INPUT: CollectSourceCreateInput = {
  name: 'HTTP 能源接口',
  code: 'energy_http',
  protocol: 'http',
  endpoint: 'https://api.example.com/metrics',
  read_mode: 'poll',
  poll_interval_ms: 1000,
  is_enabled: true,
}
function source(): CollectSource {
  return {
    id: 's1',
    name: 'HTTP 能源接口',
    code: 'energy_http',
    description: null,
    protocol: 'http',
    endpoint: 'https://api.example.com/metrics',
    username: null,
    has_credential: false,
    options_json: {},
    read_mode: 'poll',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 0,
    live_point_limit: 1000,
    runtime: {
      state: 'unknown',
      point_count: 0,
      error_category: null,
      error_detail: null,
      leader_instance: null,
      updated_at: null,
    },
    created_at: '2026-10-07T00:00:00Z',
    updated_at: '2026-10-07T00:00:00Z',
  }
}
function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<Value>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
afterEach(() => vi.restoreAllMocks())

describe('表单写请求单飞', () => {
  it('提交到列表刷新结束前不能发起另一次写入或切换表单资源', async () => {
    const pending = deferred<CollectSource>()
    const refresh = deferred<void>()
    const create = vi
      .spyOn(collectApi, 'createSource')
      .mockReturnValue(pending.promise)
    const update = vi
      .spyOn(collectApi, 'updateSource')
      .mockResolvedValue(source())
    const ops = useSourceOps(() => refresh.promise)
    ops.openCreate()
    const first = ops.create(INPUT)
    expect(ops.formSaving.value).toBe(true)
    expect(await ops.create(INPUT)).toBeNull()
    ops.openEdit(source())
    expect(ops.formSource.value).toBeNull()
    await ops.update({ name: '第二个草稿' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    pending.resolve(source())
    await pending.promise
    expect(ops.formSaving.value).toBe(true)
    ops.openCreate()
    expect(ops.formOpen.value).toBe(false)
    refresh.resolve()
    expect(await first).toBe('s1')
    expect(ops.formSaving.value).toBe(false)
  })

  it('编辑请求期间重复保存及新建入口被拒，完成后可开启新表单', async () => {
    const pending = deferred<CollectSource>()
    const update = vi
      .spyOn(collectApi, 'updateSource')
      .mockReturnValue(pending.promise)
    const ops = useSourceOps(() => Promise.resolve())
    ops.openEdit(source())
    const first = ops.update({ name: '新名称' })
    await ops.update({ name: '重复保存' })
    ops.openCreate()
    expect(ops.formSource.value?.id).toBe('s1')
    expect(update).toHaveBeenCalledExactlyOnceWith('s1', { name: '新名称' })
    pending.resolve(source())
    await first
    expect(ops.formSaving.value).toBe(false)
    expect(ops.formOpen.value).toBe(false)
    ops.openCreate()
    expect(ops.formSource.value).toBeNull()
    expect(ops.formOpen.value).toBe(true)
  })

  it('创建失败释放在途闸并保留表单，下一次显式提交可成功', async () => {
    const create = vi
      .spyOn(collectApi, 'createSource')
      .mockRejectedValueOnce(new Error('创建失败'))
      .mockResolvedValueOnce(source())
    const ops = useSourceOps(() => Promise.resolve())
    ops.openCreate()
    expect(await ops.create(INPUT)).toBeNull()
    expect(ops.formOpen.value).toBe(true)
    expect(ops.formSaving.value).toBe(false)
    expect(await ops.create(INPUT)).toBe('s1')
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('编辑失败释放在途闸并保留原资源和表单', async () => {
    vi.spyOn(collectApi, 'updateSource').mockRejectedValue(
      new Error('保存失败'),
    )
    const ops = useSourceOps(() => Promise.resolve())
    ops.openEdit(source())
    await ops.update({ name: '新名称' })
    expect(ops.formSaving.value).toBe(false)
    expect(ops.formOpen.value).toBe(true)
    expect(ops.formSource.value?.id).toBe('s1')
  })
})
