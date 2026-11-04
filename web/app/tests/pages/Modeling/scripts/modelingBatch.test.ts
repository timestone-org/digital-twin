/** @fileoverview 批量写入逐项汇总，未知结果及停止不会提交后续项。 */
import { describe, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import {
  executeModelingBatch,
  ModelingBatchRejected,
  ModelingBatchSkipped,
  ModelingBatchStopped,
} from '@/pages/Modeling/scripts/modelingBatch'
import type { ModelingBatchContext } from '@/pages/Modeling/scripts/modelingBatch'

const rows = [
  { id: 'a', name: '甲' },
  { id: 'b', name: '乙' },
  { id: 'c', name: '丙' },
]
const context: ModelingBatchContext = {
  isActive: () => true,
  ensureActive: () => {},
  read: (load) => load(new AbortController().signal),
}

describe('建模批量写入', () => {
  it('已确认的业务拒绝不会丢失成功项，也不会阻止其余项', async () => {
    const action = vi.fn((row: { id: string }) => {
      if (row.id === 'b') throw new BizError(41414, '仍被引用', 409, 'trace')
      return Promise.resolve()
    })
    const onOutcome = vi.fn()
    const report = await executeModelingBatch({
      rows,
      rowLabel: (row) => row.name,
      context,
      onOutcome,
      operation: { label: '删除', message: '删除选中记录', action },
    })
    expect(report).toMatchObject({
      succeeded: 2,
      failed: 1,
      unknown: 0,
      skipped: 0,
    })
    expect(report.outcomes.map((item) => item.status)).toEqual([
      'succeeded',
      'failed',
      'succeeded',
    ])
    expect(report.outcomes[1]).toMatchObject({
      id: 'b',
      label: '乙',
      message: '仍被引用',
    })
    expect(action.mock.calls.map(([row]) => row.id)).toEqual(['a', 'b', 'c'])
    expect(onOutcome).toHaveBeenCalledTimes(3)
  })

  it.each([
    new TransportError(0, '响应未收到'),
    new BizError(50000, '服务异常', 500, 'trace'),
    new BizError(40000, '请求超时', 408, 'trace'),
    new BizError(41443, '命令处理中', 409, 'trace'),
    new BizError(41444, '命令结果未知', 409, 'trace'),
    new Error('unknown'),
    new TransportError(400, '响应不是可识别的业务结果'),
    new BizError(50000, '网关响应未确认', 502, 'trace'),
    new BizError(50000, '服务暂不可用', 503, 'trace'),
    '响应丢失',
    null,
  ])('无法确认写入结果时保留前一成功项并停止后续：%s', async (error) => {
    const failedWrite = vi.fn<() => Promise<void>>().mockRejectedValue(error)
    const action = vi.fn((row: { id: string }) =>
      row.id === 'b' ? failedWrite() : Promise.resolve(),
    )
    const report = await executeModelingBatch({
      rows,
      rowLabel: (row) => row.name,
      context,
      onOutcome: () => {},
      operation: { label: '修改', message: '修改选中记录', action },
    })
    expect(report).toMatchObject({
      succeeded: 1,
      failed: 0,
      unknown: 1,
      skipped: 1,
    })
    expect(report.outcomes.map((item) => item.status)).toEqual([
      'succeeded',
      'unknown',
      'skipped',
    ])
    expect(action.mock.calls.map(([row]) => row.id)).toEqual(['a', 'b'])
    expect(report.outcomes[2]?.message).toContain('未提交')
  })

  it('不适用的项明确跳过且不发请求', async () => {
    const action = vi.fn(async () => {})
    const report = await executeModelingBatch({
      rows,
      rowLabel: (row) => row.name,
      context,
      onOutcome: () => {},
      operation: {
        label: '删除',
        message: '删除',
        action,
        skip: (row) => (row.id === 'b' ? '正在训练' : null),
      },
    })
    expect(report).toMatchObject({ succeeded: 2, skipped: 1 })
    expect(report.outcomes[1]).toMatchObject({
      status: 'skipped',
      message: '正在训练',
    })
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('停止只终止后续提交，已收到成功响应的项仍报告成功', async () => {
    let isActive = true
    const action = vi.fn(() => {
      isActive = false
      return Promise.resolve()
    })
    const report = await executeModelingBatch({
      rows,
      rowLabel: (row) => row.name,
      context: { ...context, isActive: () => isActive },
      onOutcome: () => {},
      operation: { label: '删除', message: '删除', action },
    })
    expect(report).toMatchObject({ succeeded: 1, skipped: 2, unknown: 0 })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('读取被取消属于未提交，不伪报成功或未知写入', async () => {
    const report = await executeModelingBatch({
      rows: rows.slice(0, 1),
      rowLabel: (row) => row.name,
      context,
      onOutcome: () => {},
      operation: {
        label: '设置定时',
        message: '设置',
        action: () => Promise.reject(new ModelingBatchStopped()),
      },
    })
    expect(report).toMatchObject({ succeeded: 0, skipped: 1, unknown: 0 })
  })

  it.each([400, 401, 403, 404, 409, 422, 429])(
    '已确定的HTTP %s拒绝仅影响当前项',
    async (status) => {
      const action = vi.fn((row: { id: string }) => {
        if (row.id === 'a')
          throw new BizError(41414, '此项被明确拒绝', status, 'trace')
        return Promise.resolve()
      })
      const report = await executeModelingBatch({
        rows,
        rowLabel: (row) => row.name,
        context,
        onOutcome: () => {},
        operation: { label: '删除', message: '删除', action },
      })
      expect(report).toMatchObject({
        failed: 1,
        succeeded: 2,
        unknown: 0,
        skipped: 0,
      })
      expect(action.mock.calls.map(([row]) => row.id)).toEqual(['a', 'b', 'c'])
    },
  )

  it.each([
    {
      error: new ModelingBatchRejected('所选周期不合法'),
      status: 'failed',
      failed: 1,
      skipped: 0,
    },
    {
      error: new ModelingBatchSkipped('定时训练已开启，保留现有配置'),
      status: 'skipped',
      failed: 0,
      skipped: 1,
    },
  ])(
    '本地预检$status保留原因并继续其他项',
    async ({ error, status, failed, skipped }) => {
      const action = vi.fn((row: { id: string }) => {
        if (row.id === 'a') throw error
        return Promise.resolve()
      })
      const report = await executeModelingBatch({
        rows,
        rowLabel: (row) => row.name,
        context,
        onOutcome: () => {},
        operation: { label: '设置定时', message: '设置', action },
      })
      expect(report).toMatchObject({
        succeeded: 2,
        failed,
        skipped,
        unknown: 0,
      })
      expect(report.outcomes[0]).toEqual({
        id: 'a',
        label: '甲',
        status,
        message: error.message,
      })
      expect(action).toHaveBeenCalledTimes(3)
    },
  )

  it('空批次没有请求或伪进度', async () => {
    const action = vi.fn(async () => {})
    const onOutcome = vi.fn()
    const report = await executeModelingBatch({
      rows: rows.slice(0, 0),
      rowLabel: (row) => row.name,
      context,
      onOutcome,
      operation: { label: '删除', message: '删除', action },
    })
    expect(report).toEqual({
      outcomes: [],
      succeeded: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
    })
    expect(action).not.toHaveBeenCalled()
    expect(onOutcome).not.toHaveBeenCalled()
  })

  it('执行前已停止时逐项标为未提交，不运行预检或动作', async () => {
    const action = vi.fn(async () => {})
    const skip = vi.fn(() => null)
    const report = await executeModelingBatch({
      rows,
      rowLabel: (row) => row.name,
      context: { ...context, isActive: () => false },
      onOutcome: () => {},
      operation: { label: '删除', message: '删除', action, skip },
    })
    expect(report).toMatchObject({
      succeeded: 0,
      failed: 0,
      unknown: 0,
      skipped: 3,
    })
    expect(action).not.toHaveBeenCalled()
    expect(skip).not.toHaveBeenCalled()
  })

  it('最终提交检查停止时不调用动作', async () => {
    const action = vi.fn(async () => {})
    const report = await executeModelingBatch({
      rows,
      rowLabel: (row) => row.name,
      context: {
        ...context,
        ensureActive: () => {
          throw new ModelingBatchStopped()
        },
      },
      onOutcome: () => {},
      operation: { label: '删除', message: '删除', action },
    })
    expect(report).toMatchObject({
      succeeded: 0,
      failed: 0,
      unknown: 0,
      skipped: 3,
    })
    expect(action).not.toHaveBeenCalled()
  })
})
