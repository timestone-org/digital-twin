/** @fileoverview 建模多选确认、失败保留、换页及卸载时终止后续写入。 */
import { useConfirm } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { BizError, TransportError } from '@/api/client'
import { useModelingBatch } from '@/pages/Modeling/scripts/useModelingBatch'
import type { ModelingBatchAction } from '@/pages/Modeling/scripts/modelingBatch'
import {
  ModelingBatchRejected,
  ModelingBatchSkipped,
} from '@/pages/Modeling/scripts/modelingBatch'

interface Row {
  id: string
  name: string
}
const wrappers: ReturnType<typeof mount>[] = []
function host() {
  const rows = ref<Row[]>([
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
  ])
  const scope = ref('page-1')
  let result: ReturnType<typeof useModelingBatch<Row>> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useModelingBatch(
          () => rows.value,
          (row) => row.name,
          () => scope.value,
        )
        return () => h('div')
      },
    }),
  )
  wrappers.push(wrapper)
  if (!result) throw new Error('未创建批量状态')
  return { batch: result, rows, scope, wrapper }
}
function operation(
  action: ModelingBatchAction<Row>['action'],
): ModelingBatchAction<Row> {
  return { label: '批量删除', message: '删除后无法恢复', danger: true, action }
}
afterEach(() => {
  useConfirm().resolve(false)
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})

it('批次结束后末页修正或重新检索仍保留完整结果，避免失败原因随翻页消失', async () => {
  const { batch, scope } = host()
  batch.selectedIds.value = ['a', 'b']
  const pending = batch.run(
    operation((row) => {
      if (row.id === 'b')
        return Promise.reject(new BizError(41414, '仍被公式引用', 409, 'trace'))
      return Promise.resolve()
    }),
  )
  useConfirm().resolve(true)
  expect(await pending).toMatchObject({ succeeded: 1, failed: 1 })
  scope.value = 'corrected-last-page'
  await flushPromises()
  expect(batch.selectedCount.value).toBe(0)
  expect(batch.state.value.outcomes.map((row) => row.status)).toEqual([
    'succeeded',
    'failed',
  ])
  expect(batch.state.value.outcomes[1]?.message).toBe('仍被公式引用')
  expect(batch.state.value.completed).toBe(2)
  expect(batch.state.value.total).toBe(2)
})

it('没有选择或用户取消时不提交，确认时冻结目标并防重复提交', async () => {
  const { batch } = host()
  const action = vi.fn(async () => {})
  expect(await batch.run(operation(action))).toBeNull()
  batch.selectedIds.value = ['a', 'b']
  const pending = batch.run(operation(action))
  expect(useConfirm().pending.value?.title).toContain('2 项')
  expect(batch.isBusy.value).toBe(true)
  const confirmationId = useConfirm().pending.value?.id
  expect(await batch.run(operation(action))).toBeNull()
  expect(useConfirm().pending.value?.id).toBe(confirmationId)
  useConfirm().resolve(false)
  expect(await pending).toBeNull()
  expect(action).not.toHaveBeenCalled()
  expect(batch.isBusy.value).toBe(false)
  expect(batch.state.value).toEqual({
    label: '',
    isBusy: false,
    completed: 0,
    total: 0,
    outcomes: [],
  })
  expect(batch.selectedIds.value).toEqual(['a', 'b'])
})

it('成功项移出选择，失败项及其具体原因保留', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a', 'b']
  const pending = batch.run(
    operation((row) => {
      if (row.id === 'b') throw new BizError(41414, '被公式引用', 409, 'trace')
      return Promise.resolve()
    }),
  )
  useConfirm().resolve(true)
  expect(await pending).toMatchObject({ succeeded: 1, failed: 1 })
  expect(batch.selectedIds.value).toEqual(['b'])
  expect(batch.state.value.outcomes[1]?.message).toBe('被公式引用')
  expect(batch.canRun.value).toBe(true)
})

it('未知结果不会允许直接重试，清除选择后才开始新批次', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a', 'b']
  const action = vi.fn(() => Promise.reject(new TransportError(0, '网络断开')))
  const pending = batch.run(operation(action))
  useConfirm().resolve(true)
  expect(await pending).toMatchObject({ unknown: 1, skipped: 1 })
  expect(batch.isBlocked.value).toBe(true)
  expect(await batch.run(operation(action))).toBeNull()
  expect(action).toHaveBeenCalledTimes(1)
  batch.clear()
  expect(batch.selectedCount.value).toBe(0)
  expect(batch.isBlocked.value).toBe(false)
})

it('刷新仅裁剪已消失的项，改变分页筛选清空整个选择', async () => {
  const { batch, rows, scope } = host()
  batch.selectedIds.value = ['a', 'b']
  rows.value = [{ id: 'b', name: '乙' }]
  await flushPromises()
  expect(batch.selectedIds.value).toEqual(['b'])
  scope.value = 'page-2'
  await flushPromises()
  expect(batch.selectedCount.value).toBe(0)
})

it.each(['unmount', 'filter'])(
  '读取中%s会中止读取且不写入旧对象',
  async (kind) => {
    const { batch, wrapper, scope } = host()
    batch.selectedIds.value = ['a', 'b']
    let finish: ((value: number) => void) | undefined
    let signal: AbortSignal | undefined
    const write = vi.fn()
    const pending = batch.run(
      operation(async (_row, context) => {
        const value = await context.read((activeSignal) => {
          signal = activeSignal
          return new Promise<number>((resolve) => {
            finish = resolve
          })
        })
        write(value)
      }),
    )
    useConfirm().resolve(true)
    await flushPromises()
    expect(signal?.aborted).toBe(false)
    if (kind === 'unmount') wrapper.unmount()
    else {
      scope.value = 'page-2'
      await flushPromises()
    }
    expect(signal?.aborted).toBe(true)
    finish?.(5)
    expect(await pending).toBeNull()
    expect(write).not.toHaveBeenCalled()
  },
)

it('手动停止不撤销已提交请求，也不提交下一项', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a', 'b']
  let finish: (() => void) | undefined
  const write = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const pending = batch.run(operation(write))
  useConfirm().resolve(true)
  await flushPromises()
  batch.clear()
  expect(batch.selectedCount.value).toBe(2)
  batch.stop()
  finish?.()
  expect(await pending).toMatchObject({ succeeded: 1, skipped: 1 })
  expect(write).toHaveBeenCalledTimes(1)
  expect(batch.isBusy.value).toBe(false)
})

it('已有显式表单确认时不再打开第二次确认', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a']
  const action = vi.fn(async () => {})
  expect(
    await batch.run({ ...operation(action), isConfirmed: true }),
  ).toMatchObject({ succeeded: 1 })
  expect(useConfirm().pending.value).toBeNull()
  expect(action).toHaveBeenCalledTimes(1)
  expect(batch.selectedIds.value).toEqual([])
})

it('确认冻结目标，新勾选项不进入已经确认的批次', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a', 'unknown']
  const action = vi.fn(async () => {})
  const pending = batch.run(operation(action))
  expect(useConfirm().pending.value?.title).toBe('批量删除 1 项？')
  batch.selectedIds.value = ['b']
  useConfirm().resolve(true)
  const report = await pending
  expect(report?.outcomes.map((row) => row.id)).toEqual(['a'])
  expect(action.mock.calls).toHaveLength(1)
  expect(batch.selectedIds.value).toEqual(['b'])
})

it('本地拒绝和正常跳过保留选中项及各自原因', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a', 'b']
  const report = await batch.run({
    ...operation((row) => {
      if (row.id === 'a') throw new ModelingBatchRejected('缺少有效周期')
      throw new ModelingBatchSkipped('已开启定时训练')
    }),
    isConfirmed: true,
  })
  expect(report).toMatchObject({
    succeeded: 0,
    failed: 1,
    skipped: 1,
    unknown: 0,
  })
  expect(batch.state.value.outcomes.map((row) => row.message)).toEqual([
    '缺少有效周期',
    '已开启定时训练',
  ])
  expect(batch.selectedIds.value).toEqual(['a', 'b'])
  expect(batch.canRun.value).toBe(true)
})

it('未知结果更换勾选后仍阻止重试，清除后允许明确的新批次', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a']
  await batch.run({
    ...operation(() => Promise.reject(new Error('回复丢失'))),
    isConfirmed: true,
  })
  batch.selectedIds.value = ['b']
  const action = vi.fn(async () => {})
  expect(batch.canRun.value).toBe(false)
  expect(
    await batch.run({ ...operation(action), isConfirmed: true }),
  ).toBeNull()
  batch.clear()
  expect(batch.state.value.outcomes).toEqual([])
  batch.selectedIds.value = ['b']
  expect(
    await batch.run({ ...operation(action), isConfirmed: true }),
  ).toMatchObject({ succeeded: 1 })
  expect(action).toHaveBeenCalledTimes(1)
})

it.each(['filter', 'unmount'] as const)(
  '等待确认时%s立即取消自己的弹窗，不留下忙状态',
  async (kind) => {
    const { batch, scope, wrapper } = host()
    batch.selectedIds.value = ['a']
    const action = vi.fn(async () => {})
    const pending = batch.run(operation(action))
    expect(useConfirm().pending.value).not.toBeNull()
    if (kind === 'filter') scope.value = 'page-2'
    else wrapper.unmount()
    await flushPromises()
    expect(useConfirm().pending.value).toBeNull()
    expect(await pending).toBeNull()
    expect(action).not.toHaveBeenCalled()
    if (kind === 'filter') expect(batch.isBusy.value).toBe(false)
  },
)

it('停止旧批次不会关闭后来打开的其他确认', async () => {
  const { batch, wrapper } = host()
  batch.selectedIds.value = ['a']
  const pending = batch.run(operation(async () => {}))
  const other = useConfirm().ask({ message: '另一项操作' })
  const otherId = useConfirm().pending.value?.id
  await pending
  wrapper.unmount()
  expect(useConfirm().pending.value?.id).toBe(otherId)
  expect(useConfirm().pending.value?.message).toBe('另一项操作')
  useConfirm().resolve(false)
  expect(await other).toBe(false)
})

it('读取中手动停止会取消读取，迟到的读取结果不能继续写入', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a', 'b']
  let signal: AbortSignal | undefined
  let finish: ((value: number) => void) | undefined
  const write = vi.fn()
  const pending = batch.run({
    ...operation(async (_row, context) => {
      const value = await context.read((activeSignal) => {
        signal = activeSignal
        return new Promise<number>((resolve) => {
          finish = resolve
        })
      })
      write(value)
    }),
    isConfirmed: true,
  })
  await flushPromises()
  batch.stop()
  expect(signal?.aborted).toBe(true)
  if (!finish) throw new Error('读取没有开始')
  finish(8)
  expect(await pending).toMatchObject({ succeeded: 0, unknown: 0, skipped: 2 })
  expect(write).not.toHaveBeenCalled()
  expect(batch.selectedIds.value).toEqual(['a', 'b'])
})

it.each(['filter', 'unmount'] as const)(
  '已提交写入后%s等待其结束，后续项不再提交或污染结果',
  async (kind) => {
    const { batch, scope, wrapper } = host()
    batch.selectedIds.value = ['a', 'b']
    let finish: (() => void) | undefined
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const pending = batch.run({ ...operation(write), isConfirmed: true })
    await flushPromises()
    if (kind === 'filter') {
      scope.value = 'page-2'
      await flushPromises()
    } else wrapper.unmount()
    const outcomes = batch.state.value.outcomes
    if (!finish) throw new Error('写入没有提交')
    expect(write).toHaveBeenCalledTimes(1)
    finish()
    expect(await pending).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
    expect(batch.state.value.outcomes).toEqual(outcomes)
    if (kind === 'filter') {
      expect(batch.selectedIds.value).toEqual([])
      expect(batch.state.value.outcomes).toEqual([])
      expect(batch.isBusy.value).toBe(false)
    }
  },
)

it('scope切换取消后可以选择新结果并运行新批次', async () => {
  const { batch, scope } = host()
  batch.selectedIds.value = ['a']
  scope.value = 'page-2'
  await flushPromises()
  batch.selectedIds.value = ['b']
  expect(
    await batch.run({ ...operation(async () => {}), isConfirmed: true }),
  ).toMatchObject({ succeeded: 1 })
  expect(batch.state.value.outcomes.map((row) => row.id)).toEqual(['b'])
})

it.each([
  {
    error: new TransportError(0, '读取定时规则失败'),
    message: '读取定时规则失败',
  },
  {
    error: new BizError(50000, '读取服务暂不可用', 503, 'trace'),
    message: '读取服务暂不可用',
  },
  {
    error: new BizError(41414, '工作流不可读取', 404, 'trace'),
    message: '工作流不可读取',
  },
  { error: new Error('内部读取异常'), message: '请求失败，请重试' },
  { error: undefined, message: '请求失败，请重试' },
])(
  '前置读取失败只拒绝该项，尚未提交写入不标为未知：$message',
  async ({ error, message }) => {
    const { batch } = host()
    batch.selectedIds.value = ['a', 'b']
    const write = vi.fn()
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('b')
    const report = await batch.run({
      ...operation(async (_row, context) => {
        const value = await context.read(load)
        context.ensureActive()
        write(value)
      }),
      isConfirmed: true,
    })
    expect(report).toMatchObject({
      failed: 1,
      succeeded: 1,
      skipped: 0,
      unknown: 0,
    })
    expect(report?.outcomes[0]?.message).toBe(message)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('b')
    expect(batch.selectedIds.value).toEqual(['a'])
    expect(batch.isBlocked.value).toBe(false)
  },
)

it('成功但不返回值的前置读取不会被误当成停止', async () => {
  const { batch } = host()
  batch.selectedIds.value = ['a']
  const write = vi.fn()
  expect(
    await batch.run({
      ...operation(async (_row, context) => {
        await context.read(() => Promise.resolve(undefined))
        write()
      }),
      isConfirmed: true,
    }),
  ).toMatchObject({ succeeded: 1, skipped: 0, failed: 0, unknown: 0 })
  expect(write).toHaveBeenCalledTimes(1)
})

it('未知结果换scope后仍需显式清除才能解除阻断', async () => {
  const { batch, scope } = host()
  batch.selectedIds.value = ['a', 'b']
  await batch.run({
    ...operation(() => Promise.reject(new TransportError(0, '响应未确认'))),
    isConfirmed: true,
  })
  scope.value = 'page-2'
  await flushPromises()
  expect(batch.selectedIds.value).toEqual([])
  expect(batch.state.value.outcomes).toEqual([
    { id: 'a', label: '甲', status: 'unknown', message: '响应未确认' },
  ])
  expect(batch.isBlocked.value).toBe(true)
  batch.selectedIds.value = ['b']
  const action = vi.fn(async () => {})
  expect(
    await batch.run({ ...operation(action), isConfirmed: true }),
  ).toBeNull()
  expect(action).not.toHaveBeenCalled()
  batch.clear()
  expect(batch.isBlocked.value).toBe(false)
})

it('旧scope已提交写入迟到的未知结果仍保留核查提示和阻断', async () => {
  const { batch, scope } = host()
  batch.selectedIds.value = ['a', 'b']
  let fail: ((error: Error) => void) | undefined
  const write = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
  )
  const pending = batch.run({ ...operation(write), isConfirmed: true })
  await flushPromises()
  scope.value = 'page-2'
  await flushPromises()
  if (!fail) throw new Error('写请求尚未提交')
  fail(new TransportError(0, '旧工作流写入结果待核查'))
  expect(await pending).toBeNull()
  expect(write).toHaveBeenCalledTimes(1)
  expect(batch.state.value.outcomes).toEqual([
    {
      id: 'a',
      label: '甲',
      status: 'unknown',
      message: '旧工作流写入结果待核查',
    },
  ])
  expect(batch.isBlocked.value).toBe(true)
  batch.selectedIds.value = ['b']
  expect(batch.canRun.value).toBe(false)
})

it('组件卸载后迟到的未知写入结果不更新已释放的状态', async () => {
  const { batch, wrapper } = host()
  batch.selectedIds.value = ['a', 'b']
  let fail: ((error: Error) => void) | undefined
  const write = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
  )
  const pending = batch.run({ ...operation(write), isConfirmed: true })
  await flushPromises()
  wrapper.unmount()
  const before = batch.state.value
  if (!fail) throw new Error('写请求尚未提交')
  fail(new TransportError(0, '响应未确认'))
  expect(await pending).toBeNull()
  expect(write).toHaveBeenCalledTimes(1)
  expect(batch.state.value).toBe(before)
})
