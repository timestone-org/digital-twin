/** @fileoverview 挂起的写或确认在卸载后不得写任何状态、派发或发起恢复读取。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref, watch } from 'vue'
import type { DatasetBackfillJob, DatasetTable } from '@dt/contracts'
import * as dataset from '@/api/dataset'
import { useAuthStore } from '@/stores/auth'
import { useDatasetBackfill } from '@/pages/Dataset/TableDetail/scripts/useDatasetBackfill'

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('@dt/ui', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@dt/ui')),
  useConfirm: () => ({ ask: confirm }),
}))
const STAMP = '2026-01-01T00:00:00.000Z'
const TABLE: DatasetTable = {
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
}
const JOB: DatasetBackfillJob = {
  table_id: 't1',
  table_code: 'energy',
  status: 'running',
  interval_ms: 3600000,
  since: STAMP,
  until: STAMP,
  requested_since: STAMP,
  requested_until: STAMP,
  is_clamped: false,
  fast_path: 'raw',
  total_buckets: 1,
  done_buckets: 0,
  written_rows: 0,
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
async function harness() {
  let task: ReturnType<typeof useDatasetBackfill> | undefined
  const target = ref(TABLE)
  const wrapper = mount(
    defineComponent({
      setup() {
        task = useDatasetBackfill(() => target.value)
        return () => h('div')
      },
    }),
  )
  if (!task) throw new Error('missing task')
  task.isOpen.value = true
  await flushPromises()
  task.since.value = STAMP
  task.until.value = STAMP
  return { wrapper, task, target }
}
function observe(task: ReturnType<typeof useDatasetBackfill>) {
  const changed = vi.fn()
  const stop = watch(
    () => [
      task.isOpen.value,
      task.job.value,
      task.since.value,
      task.until.value,
      task.loading.value,
      task.busy.value,
      task.uncertain.value,
      task.error.value,
      task.notice.value,
    ],
    changed,
    { flush: 'sync' },
  )
  return { changed, stop }
}
beforeEach(() => {
  setActivePinia(createPinia())
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
    role_permissions: ['dataset:view', 'dataset:backfill'],
    direct_permissions: [],
    permissions: ['dataset:view', 'dataset:backfill'],
  }
  confirm.mockReset().mockResolvedValue(true)
  vi.spyOn(dataset, 'getDatasetBackfill').mockResolvedValue(null)
  vi.spyOn(dataset, 'startDatasetBackfill').mockResolvedValue(JOB)
  vi.spyOn(dataset, 'cancelDatasetBackfill').mockResolvedValue(JOB)
})
afterEach(() => vi.restoreAllMocks())

describe('卸载后的挂起动作', () => {
  it.each([
    ['start', 'switch'],
    ['cancel', 'switch'],
    ['start', 'close'],
    ['cancel', 'close'],
    ['start', 'revoke'],
    ['cancel', 'revoke'],
  ] as const)(
    '确认 %s 已恢复但续体前 %s：释放忙状态并可重新操作',
    async (action, change) => {
      const pending = deferred<boolean>()
      confirm.mockReturnValueOnce(pending.promise)
      vi.mocked(dataset.getDatasetBackfill).mockImplementation((id) =>
        Promise.resolve(action === 'cancel' ? { ...JOB, table_id: id } : null),
      )
      const { task, wrapper, target } = await harness()
      const auth = useAuthStore()
      const user = auth.user
      if (!user) throw new Error('missing caller')
      const execution = task[action]()
      await flushPromises()
      void pending.promise.then(() => {
        if (change === 'switch') target.value = { ...TABLE, id: 't2' }
        else if (change === 'close') task.isOpen.value = false
        else
          auth.user = {
            ...user,
            role_permissions: ['dataset:view'],
            permissions: ['dataset:view'],
          }
      })
      pending.resolve(true)
      await execution
      await flushPromises()
      const invalidIsBusy = task.busy.value
      const invalidStarts = vi.mocked(dataset.startDatasetBackfill).mock.calls
        .length
      const invalidCancels = vi.mocked(dataset.cancelDatasetBackfill).mock.calls
        .length
      const invalidReadId = vi
        .mocked(dataset.getDatasetBackfill)
        .mock.calls.at(-1)?.[0]
      auth.user = user
      task.isOpen.value = true
      await flushPromises()
      task.since.value = STAMP
      task.until.value = STAMP
      await task[action]()
      await flushPromises()
      wrapper.unmount()
      expect(invalidIsBusy).toBe(false)
      expect(invalidStarts).toBe(0)
      expect(invalidCancels).toBe(0)
      expect(invalidReadId).toBe(change === 'switch' ? 't2' : 't1')
      expect(dataset.startDatasetBackfill).toHaveBeenCalledTimes(
        action === 'start' ? 1 : 0,
      )
      expect(dataset.cancelDatasetBackfill).toHaveBeenCalledTimes(
        action === 'cancel' ? 1 : 0,
      )
    },
  )

  it.each(['start', 'cancel'] as const)(
    '确认 %s 已恢复但调用方续体前卸载：仍不写状态或派发',
    async (action) => {
      const pending = deferred<boolean>()
      confirm.mockReturnValueOnce(pending.promise)
      if (action === 'cancel')
        vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(JOB)
      const { task, wrapper } = await harness()
      const execution = task[action]()
      await flushPromises()
      let observed: ReturnType<typeof observe> | undefined
      void pending.promise.then(() => {
        wrapper.unmount()
        observed = observe(task)
      })
      const reads = vi.mocked(dataset.getDatasetBackfill).mock.calls.length
      pending.resolve(true)
      await execution
      await flushPromises()
      if (!observed) throw new Error('missing unmount observer')
      observed.stop()
      expect(observed.changed).not.toHaveBeenCalled()
      expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(reads)
      expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
      expect(dataset.cancelDatasetBackfill).not.toHaveBeenCalled()
    },
  )

  it.each(['POST', 'DELETE'])(
    '挂起 %s 卸载后回执落地：零 ref 写、零新增请求',
    async (method) => {
      const pending = deferred<DatasetBackfillJob>()
      if (method === 'DELETE') {
        vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(JOB)
        vi.mocked(dataset.cancelDatasetBackfill).mockReturnValueOnce(
          pending.promise,
        )
      } else
        vi.mocked(dataset.startDatasetBackfill).mockReturnValueOnce(
          pending.promise,
        )
      const { task, wrapper } = await harness()
      const execution = method === 'DELETE' ? task.cancel() : task.start()
      await flushPromises()
      expect(task.busy.value).toBe(true)
      wrapper.unmount()
      const observed = observe(task)
      const reads = vi.mocked(dataset.getDatasetBackfill).mock.calls.length
      pending.resolve(JOB)
      await execution
      await flushPromises()
      observed.stop()
      expect(observed.changed).not.toHaveBeenCalled()
      expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(reads)
      expect(dataset.startDatasetBackfill).toHaveBeenCalledTimes(
        method === 'POST' ? 1 : 0,
      )
      expect(dataset.cancelDatasetBackfill).toHaveBeenCalledTimes(
        method === 'DELETE' ? 1 : 0,
      )
    },
  )

  it.each(['start', 'cancel'] as const)(
    '挂起 %s 确认卸载后批准：零 ref 写、零派发',
    async (action) => {
      const pending = deferred<boolean>()
      confirm.mockReturnValueOnce(pending.promise)
      if (action === 'cancel')
        vi.mocked(dataset.getDatasetBackfill).mockResolvedValue(JOB)
      const { task, wrapper } = await harness()
      const execution = task[action]()
      await flushPromises()
      wrapper.unmount()
      const observed = observe(task)
      const reads = vi.mocked(dataset.getDatasetBackfill).mock.calls.length
      pending.resolve(true)
      await execution
      await flushPromises()
      observed.stop()
      expect(observed.changed).not.toHaveBeenCalled()
      expect(dataset.getDatasetBackfill).toHaveBeenCalledTimes(reads)
      expect(dataset.startDatasetBackfill).not.toHaveBeenCalled()
      expect(dataset.cancelDatasetBackfill).not.toHaveBeenCalled()
    },
  )
})
