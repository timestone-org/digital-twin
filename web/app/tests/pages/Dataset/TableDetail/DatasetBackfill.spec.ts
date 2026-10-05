/** @fileoverview 回填 UI 的权限、逐次确认、竞态、取消和真实回执展示；API 为测试替身。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from '@vue/test-utils'
import type { DatasetBackfillJob, DatasetTable } from '@dt/contracts'
import * as dataset from '@/api/dataset'
import { BizError, TransportError } from '@/api/client'
import DatasetBackfill from '@/pages/Dataset/TableDetail/components/DatasetBackfill.vue'
import { useAuthStore } from '@/stores/auth'

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('@dt/ui', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@dt/ui')),
  useConfirm: () => ({ ask: confirm }),
}))

const STAMP = '2026-01-01T00:00:00.000Z'
function table(over: Partial<DatasetTable> = {}): DatasetTable {
  return {
    id: 't1',
    code: 'energy',
    name: '能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3600000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    columns: [],
    ...over,
  }
}
function job(over: Partial<DatasetBackfillJob> = {}): DatasetBackfillJob {
  return {
    table_id: 't1',
    table_code: 'energy',
    status: 'running',
    interval_ms: 3600000,
    since: STAMP,
    until: '2026-01-02T00:00:00.000Z',
    requested_since: STAMP,
    requested_until: '2026-01-02T00:00:00.000Z',
    is_clamped: false,
    fast_path: 'raw',
    total_buckets: 25,
    done_buckets: 3,
    written_rows: 3,
    recomputed: 0,
    recompute_failed: 0,
    is_recompute_truncated: false,
    cursor: null,
    started_at: STAMP,
    updated_at: STAMP,
    finished_at: null,
    error: null,
    message: '',
    notes: [],
    ...over,
  }
}
function signIn(codes = ['dataset:view', 'dataset:backfill']): void {
  useAuthStore().user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'r1', name: 'ops', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  useAuthStore().accessToken = 'test-token'
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('promise not initialized')
  }
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function render(over: Partial<DatasetTable> = {}, codes?: string[]) {
  signIn(codes)
  const wrapper = mount(DatasetBackfill, {
    props: { table: table(over) },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return wrapper
}
async function open(wrapper: VueWrapper): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === '回填进度')
  if (!button) throw new Error('missing progress button')
  await button.trigger('click')
  await flushPromises()
}
async function fillRange(
  wrapper: VueWrapper,
  since = '2026-01-01T00:00',
  until = '2026-01-02T00:00',
): Promise<void> {
  const inputs = wrapper.findAll('input[type="datetime-local"]')
  if (!inputs[0] || !inputs[1]) throw new Error('missing period fields')
  await inputs[0].setValue(since)
  await inputs[1].setValue(until)
}
beforeEach(() => {
  setActivePinia(createPinia())
  confirm.mockReset().mockResolvedValue(true)
  vi.spyOn(dataset, 'getDatasetBackfill').mockResolvedValue(null)
  vi.spyOn(dataset, 'startDatasetBackfill').mockResolvedValue(job())
  vi.spyOn(dataset, 'cancelDatasetBackfill').mockResolvedValue(job())
})
enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('入口、确认与实际回执', () => {
  it('读者与仅 manage 账号可看状态，写控件不在 DOM', async () => {
    const wrapper = await render({}, ['dataset:view', 'dataset:manage'])
    await open(wrapper)
    expect(wrapper.find('[data-test="backfill-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="backfill-start"]').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
  })
  it('手动台账不可启动且不发 GET；停用的汇总台账仍可回填', async () => {
    const manual = await render({ collect_mode: 'manual' })
    expect(manual.text()).toContain('不支持历史桶回填')
    expect(dataset.getDatasetBackfill).not.toHaveBeenCalled()
    manual.unmount()
    const aggregate = await render({ is_enabled: false })
    expect(aggregate.find('[data-test="backfill-open"]').exists()).toBe(true)
  })
  it('空范围或反向范围不能提交', async () => {
    const wrapper = await render()
    await open(wrapper)
    expect(
      wrapper.get('[data-test="backfill-start"]').attributes('disabled'),
    ).toBeDefined()
    await fillRange(wrapper, '2026-01-03T00:00', '2026-01-01T00:00')
    expect(
      wrapper.get('[data-test="backfill-start"]').attributes('disabled'),
    ).toBeDefined()
    expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
  })
  it('拒绝确认不写，下一次开始仍逐次确认，提交 UTC 并显示实际范围', async () => {
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    confirm.mockResolvedValueOnce(false)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await flushPromises()
    expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(dataset.startDatasetBackfill).toHaveBeenCalledWith('t1', {
      since: new Date('2026-01-01T00:00').toISOString(),
      until: new Date('2026-01-02T00:00').toISOString(),
    })
    expect(wrapper.text()).toContain('桶进度 3 / 25')
    expect(wrapper.text()).toContain('实际范围')
  })
  it('等待确认时重复点击不会并发启动，权限变更后不派发', async () => {
    const pending = deferred<boolean>()
    confirm.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    expect(confirm).toHaveBeenCalledTimes(1)
    signIn(['dataset:view'])
    pending.resolve(true)
    await flushPromises()
    expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
  })
  it('取消需确认，DELETE 返回 running 时不能冒充已取消', async () => {
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(job())
    const wrapper = await render()
    await open(wrapper)
    confirm.mockResolvedValueOnce(false)
    await wrapper.get('[data-test="backfill-cancel"]').trigger('click')
    await flushPromises()
    expect(dataset.cancelDatasetBackfill).not.toHaveBeenCalled()
    await wrapper.get('[data-test="backfill-cancel"]').trigger('click')
    await flushPromises()
    expect(dataset.cancelDatasetBackfill).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('等待后台实际终态')
    expect(wrapper.text()).not.toContain('任务已取消')
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({ status: 'cancelled' }),
    )
    await wrapper.get('[data-test="backfill-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('任务已取消，已经写入的历史桶保留')
  })
  it('完成、失败、裁剪和未完成重算逐项展示，不假报完整成功', async () => {
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({
        status: 'done',
        is_clamped: true,
        is_recompute_truncated: true,
        recompute_failed: 1,
        notes: ['已裁剪历史范围'],
        finished_at: STAMP,
      }),
    )
    const wrapper = await render()
    await open(wrapper)
    expect(wrapper.text()).toContain('回填完成')
    expect(wrapper.text()).toContain('后续公式重算未全部完成')
    expect(wrapper.text()).toContain('已裁剪历史范围')
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({ status: 'failed', error: 'history unavailable' }),
    )
    await wrapper.get('[data-test="backfill-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('回填失败')
    expect(wrapper.text()).toContain('history unavailable')
  })
})

describe('恢复、排他与竞态', () => {
  it('确认期间关闭或返回另一张台账，不派发旧开始请求', async () => {
    const pending = deferred<boolean>()
    confirm.mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await wrapper.get('button[aria-label="关闭"]').trigger('click')
    pending.resolve(true)
    await flushPromises()
    expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
    const next = deferred<boolean>()
    confirm.mockReturnValueOnce(next.promise)
    await open(wrapper)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await wrapper.setProps({ table: table({ id: 't2' }) })
    next.resolve(true)
    await flushPromises()
    expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
    expect(dataset.getDatasetBackfill).toHaveBeenLastCalledWith(
      't2',
      expect.any(AbortSignal),
    )
  })

  it('换表后迟到写回执不覆盖新表，结束旧写后恢复新表实际 GET', async () => {
    const pending = deferred<DatasetBackfillJob>()
    vi.mocked(dataset.startDatasetBackfill).mockReturnValueOnce(pending.promise)
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({ table: table({ id: 't2' }) })
    pending.resolve(job())
    await flushPromises()
    await open(wrapper)
    expect(wrapper.text()).not.toContain('桶进度 3 / 25')
    expect(dataset.getDatasetBackfill).toHaveBeenLastCalledWith(
      't2',
      expect.any(AbortSignal),
    )
  })

  it('运行中关闭停止轮询，重开后继续；卸载也停止并取消 GET', async () => {
    vi.useFakeTimers()
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(job())
    const wrapper = await render()
    await open(wrapper)
    await wrapper.get('button[aria-label="关闭"]').trigger('click')
    await flushPromises()
    const calls = vi.mocked(dataset.getDatasetBackfill).mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(calls)
    await open(wrapper)
    const signal = vi.mocked(dataset.getDatasetBackfill).mock.calls.at(-1)?.[1]
    wrapper.unmount()
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(dataset.cancelDatasetBackfill).not.toHaveBeenCalled()
  })

  it('409 只 GET 实际任务，不重试 POST', async () => {
    vi.mocked(dataset.startDatasetBackfill).mockRejectedValue(
      new BizError(41231, 'active', 409, 'trace'),
    )
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(job())
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await flushPromises()
    expect(dataset.startDatasetBackfill).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('已有任务正在执行')
    expect(wrapper.text()).toContain('桶进度 3 / 25')
  })

  it('其他 409 不冒充已有回填，取消时 41232 才读取实际终态', async () => {
    vi.mocked(dataset.startDatasetBackfill).mockRejectedValue(
      new BizError(40901, 'different request', 409, 'trace'),
    )
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('different request')
    expect(wrapper.text()).not.toContain('已有任务正在执行')
    expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(2)
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(job())
    await wrapper.get('[data-test="backfill-refresh"]').trigger('click')
    await flushPromises()
    vi.mocked(dataset.cancelDatasetBackfill).mockRejectedValue(
      new BizError(41232, 'not running', 404, 'trace'),
    )
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({ status: 'done' }),
    )
    await wrapper.get('[data-test="backfill-cancel"]').trigger('click')
    await flushPromises()
    expect(dataset.cancelDatasetBackfill).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('任务已不在运行')
    expect(wrapper.text()).toContain('回填完成')
  })
  it.each([
    new TransportError(0, 'timeout'),
    new BizError(503, 'unavailable', 503, 'trace'),
  ])('写结果未知时禁再开始，手动 GET 后才恢复：%s', async (error) => {
    vi.mocked(dataset.startDatasetBackfill).mockRejectedValue(error)
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    await wrapper.get('[data-test="backfill-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('操作状态未确认')
    expect(
      wrapper.get('[data-test="backfill-start"]').attributes('disabled'),
    ).toBeDefined()
    expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(2)
    expect(dataset.startDatasetBackfill).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-test="backfill-refresh"]').trigger('click')
    await flushPromises()
    expect(
      wrapper.get('[data-test="backfill-start"]').attributes('disabled'),
    ).toBeUndefined()
  })
  it('GET 失败保留最后回执并锁写，不当成没有任务', async () => {
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({ status: 'done' }),
    )
    const wrapper = await render()
    await open(wrapper)
    await fillRange(wrapper)
    vi.mocked(dataset.getDatasetBackfill).mockRejectedValue(
      new TransportError(503, 'offline'),
    )
    await wrapper.get('[data-test="backfill-refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('回填完成')
    expect(wrapper.text()).toContain('进度读取失败')
    expect(
      wrapper.get('[data-test="backfill-start"]').attributes('disabled'),
    ).toBeDefined()
  })
  it('关闭不取消任务，重新打开 GET 恢复实际状态', async () => {
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(job())
    const wrapper = await render()
    await open(wrapper)
    await wrapper.get('button[aria-label="关闭"]').trigger('click')
    await flushPromises()
    expect(dataset.cancelDatasetBackfill).not.toHaveBeenCalled()
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({ status: 'done' }),
    )
    await open(wrapper)
    expect(wrapper.text()).toContain('回填完成')
    expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
  })
  it('换表及同表重开舍弃迟到 GET 回执，并中止旧读取', async () => {
    const slow = deferred<DatasetBackfillJob | null>()
    const wrapper = await render()
    vi.mocked(dataset.getDatasetBackfill).mockReturnValueOnce(slow.promise)
    const click = wrapper.get('[data-test="backfill-open"]').trigger('click')
    await click
    const signal = vi.mocked(dataset.getDatasetBackfill).mock.calls.at(-1)?.[1]
    await wrapper.setProps({ table: table({ id: 't2', name: '第二张' }) })
    await flushPromises()
    expect(signal?.aborted).toBe(true)
    slow.resolve(job())
    await flushPromises()
    await open(wrapper)
    expect(wrapper.text()).not.toContain('桶进度 3 / 25')
  })
  it('只在打开且 running 时轮询，终态、关闭及卸载停止定时器', async () => {
    vi.useFakeTimers()
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(job())
    const wrapper = await render()
    await open(wrapper)
    vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(
      job({ status: 'done' }),
    )
    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()
    expect(wrapper.text()).toContain('回填完成')
    const calls = vi.mocked(dataset.getDatasetBackfill).mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(calls)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
