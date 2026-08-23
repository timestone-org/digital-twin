/**
 * @fileoverview 列配置的写动作契约：删除是两段式且第二句话要**点名**会坏掉的
 * 那几条公式，重排是乐观的、失败靠整份重取回滚。
 *
 * ⚠ 「点名」这条只能在这里守：后端把引用者摊在信封的 `details` 里，`message`
 * 只说得出一个条数。哪天 details 被谁丢掉，界面照常能删，只是第二句话退回
 * 「仍然删除吗」——没有任何一道现成的闸门会响。
 */
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { DatasetColumn, FieldError } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as dataset from '@/api/dataset'
import { useColumnOps } from '@/pages/Dataset/TableDetail/scripts/useColumnOps'

interface ConfirmAsk {
  title?: string
  message: string
  confirmText?: string
  danger?: boolean
}

const confirmSpy = vi.fn<(request: ConfirmAsk) => Promise<boolean>>()
const toastError = vi.fn<(message: string) => void>()
const toastSuccess = vi.fn<(message: string) => void>()

vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
    }),
  }
})

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'inflow',
    name: '进水量',
    unit: null,
    decimals: null,
    data_type: 'number',
    source: 'manual',
    agg: 'avg',
    node_key: null,
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

const THREE = [
  column({ id: 'c1', key: 'inflow', name: '进水量', order_index: 0 }),
  column({ id: 'c2', key: 'outflow', name: '出水量', order_index: 1 }),
  column({ id: 'c3', key: 'ratio', name: '回用率', order_index: 2 }),
]

function referenced(...keys: string[]): BizError {
  const details: FieldError[] = keys.map((key) => ({
    field: `columns[${key}]`,
    code: 'column_referenced',
    message: `${key} 的公式引用了这一列`,
  }))
  return new BizError(
    ERROR_CODES.datasetColumnInUse,
    `还有 ${keys.length} 列的公式引用着这一列，请先改公式`,
    409,
    'trace',
    details,
  )
}

function harness() {
  const columns = ref<DatasetColumn[]>([...THREE])
  const reloadColumns = vi.fn(async () => {
    columns.value = [...THREE]
    await Promise.resolve()
  })
  const ops = useColumnOps({
    tableId: () => 't1',
    columns,
    setColumns: (next) => (columns.value = [...next]),
    reloadColumns,
  })
  return { columns, ops, reloadColumns }
}

beforeEach(() => {
  confirmSpy.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
  vi.spyOn(dataset, 'deleteDatasetColumn').mockResolvedValue(undefined)
  vi.spyOn(dataset, 'reorderDatasetColumns').mockResolvedValue([...THREE])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('两段式删除', () => {
  it('第一段问一次，取消就一个请求都不发', async () => {
    confirmSpy.mockResolvedValue(false)
    const { ops } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    expect(dataset.deleteDatasetColumn).not.toHaveBeenCalled()
  })

  it('确认后先发一次**不带 force** 的删除', async () => {
    confirmSpy.mockResolvedValue(true)
    const { ops, reloadColumns } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    expect(dataset.deleteDatasetColumn).toHaveBeenCalledWith('t1', 'c1')
    expect(reloadColumns).toHaveBeenCalled()
  })

  it('⚠ 后端说被引用时，第二句话点名那几列的**名称**，而不是只报一个条数', async () => {
    confirmSpy.mockResolvedValue(true)
    vi.mocked(dataset.deleteDatasetColumn).mockRejectedValueOnce(
      referenced('outflow', 'ratio'),
    )
    const { ops } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    const second = confirmSpy.mock.calls[1]?.[0]
    expect(second?.message).toContain('「出水量」')
    expect(second?.message).toContain('「回用率」')
    expect(second?.confirmText).toBe('仍然删除')
  })

  it('第二段确认后带 force 重发，且两次各用各的幂等键', async () => {
    confirmSpy.mockResolvedValue(true)
    vi.mocked(dataset.deleteDatasetColumn).mockRejectedValueOnce(
      referenced('outflow'),
    )
    const { ops } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    expect(dataset.deleteDatasetColumn).toHaveBeenNthCalledWith(
      2,
      't1',
      'c1',
      true,
    )
  })

  it('第二段被取消就到此为止，不带 force 重发', async () => {
    confirmSpy.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    vi.mocked(dataset.deleteDatasetColumn).mockRejectedValueOnce(
      referenced('outflow'),
    )
    const { ops } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    expect(vi.mocked(dataset.deleteDatasetColumn).mock.calls).toHaveLength(1)
  })

  it('⚠ 按码分支：别的失败不升级成第二段，直接报出来', async () => {
    confirmSpy.mockResolvedValue(true)
    vi.mocked(dataset.deleteDatasetColumn).mockRejectedValueOnce(
      new BizError(ERROR_CODES.notFound, '这一列不存在', 404, 'trace'),
    )
    const { ops } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('这一列不存在')
  })

  it('信封里没有 details 时仍然升级再问一次，只是点不出名字', async () => {
    confirmSpy.mockResolvedValue(true)
    vi.mocked(dataset.deleteDatasetColumn).mockRejectedValueOnce(
      new BizError(
        ERROR_CODES.datasetColumnInUse,
        '还有列引用它',
        409,
        'trace',
      ),
    )
    const { ops } = harness()

    await ops.removeColumn(THREE[0] ?? column())

    expect(confirmSpy).toHaveBeenCalledTimes(2)
  })
})

describe('乐观重排', () => {
  it('先动界面：不等一个来回，连点上下移才跟得上手', async () => {
    const { columns, ops } = harness()
    let resolveIt = (): void => undefined
    vi.mocked(dataset.reorderDatasetColumns).mockReturnValueOnce(
      new Promise((done) => {
        resolveIt = () => done([...THREE])
      }),
    )

    const running = ops.moveColumn(THREE[0] ?? column(), 1)
    await flushPromises()

    expect(columns.value.map((one) => one.id)).toEqual(['c2', 'c1', 'c3'])
    resolveIt()
    await running
  })

  it('落库时给的是整份目标顺序', async () => {
    const { ops } = harness()

    await ops.moveColumn(THREE[2] ?? column(), -1)

    expect(dataset.reorderDatasetColumns).toHaveBeenCalledWith('t1', [
      'c1',
      'c3',
      'c2',
    ])
  })

  it('⚠ 失败的回滚是整份重取：换回来等于拿想当然的顺序覆盖真实的那份', async () => {
    const { ops, columns, reloadColumns } = harness()
    vi.mocked(dataset.reorderDatasetColumns).mockRejectedValueOnce(
      new BizError(ERROR_CODES.conflict, '顺序保存失败', 409, 'trace'),
    )

    await ops.moveColumn(THREE[0] ?? column(), 1)

    expect(toastError).toHaveBeenCalledWith('顺序保存失败')
    expect(reloadColumns).toHaveBeenCalled()
    expect(columns.value.map((one) => one.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('顶到边界时什么都不做，不发一个把顺序原样写回去的请求', async () => {
    const { ops } = harness()

    await ops.moveColumn(THREE[0] ?? column(), -1)
    await ops.moveColumn(THREE[2] ?? column(), 1)

    expect(dataset.reorderDatasetColumns).not.toHaveBeenCalled()
  })
})

describe('弹窗开合', () => {
  it('新增时不带任何现值，编辑时带上要改的那一列', () => {
    const { ops } = harness()

    ops.openEdit(THREE[1] ?? column())
    expect(ops.isFormOpen.value).toBe(true)
    expect(ops.editing.value?.id).toBe('c2')

    ops.openCreate()
    expect(ops.editing.value).toBeNull()
  })

  it('保存成功后报一句并重取列', async () => {
    const { ops, reloadColumns } = harness()

    await ops.afterSaved('列已新增')

    expect(toastSuccess).toHaveBeenCalledWith('列已新增')
    expect(reloadColumns).toHaveBeenCalled()
  })
})
