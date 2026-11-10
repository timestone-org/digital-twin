/** @fileoverview 点位建 / 改提交在途时不重复发请求。 */
import { expect, it, vi } from 'vitest'
import type { CollectPointItemInput } from '@dt/contracts'
import { usePointEditing } from '../../../../src/pages/Collect/scripts/usePointEditing'
import type { PointOps } from '../../../../src/pages/Collect/scripts/usePointOps'
import { POINT } from '../../../../src/testing/knowledgeLive'

function deferred() {
  let resolve: (value: boolean) => void = () => undefined
  const promise = new Promise<boolean>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const ITEM: CollectPointItemInput = {
  code: 'p1',
  name: '点位',
  description: null,
  address: 'ns=2;s=P1',
  data_type: 'float',
  unit: null,
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60_000,
  archive_retention_days: null,
}

function setup() {
  const pending = deferred()
  const create = vi.fn(() => pending.promise)
  const update = vi.fn(() => pending.promise)
  const ops: PointOps = {
    create,
    update,
    remove: vi.fn(() => Promise.resolve(true)),
    write: vi.fn(() => Promise.resolve(true)),
    exportCsv: vi.fn(() => Promise.resolve()),
    fetchAll: vi.fn(() => Promise.resolve([])),
  }
  const reload = vi.fn(() => Promise.resolve())
  return { editing: usePointEditing(ops, reload), pending, create, update }
}

it('新建在途时再点保存不再发第二次请求，结束后解除', async () => {
  const { editing, pending, create } = setup()
  editing.openCreate()
  const first = editing.create(ITEM)
  expect(editing.formBusy.value).toBe(true)
  await editing.create(ITEM)
  expect(create).toHaveBeenCalledTimes(1)
  pending.resolve(true)
  await first
  expect(editing.formBusy.value).toBe(false)
  expect(editing.formOpen.value).toBe(false)
})

it('修改在途时再点保存不再发第二次请求', async () => {
  const { editing, pending, update } = setup()
  editing.openEdit(POINT)
  const first = editing.update({ name: '新名' })
  await editing.update({ name: '新名' })
  expect(update).toHaveBeenCalledTimes(1)
  pending.resolve(false)
  await first
  expect(editing.formBusy.value).toBe(false)
  expect(editing.formOpen.value).toBe(true)
})
