/**
 * @fileoverview 录入 / 编辑弹窗的契约：打开即铺好现值、点位汇总列不动就不提交、
 * 编辑走的 `?ts=` 是**改之前**那个时刻。
 *
 * ⚠ 「不动就不提交」这条只能在这里守：原样回传一遍在界面上什么都看不出来，
 * 后端却会给整行的点位列各建一条人工修正，署名是这次点保存的人。
 * ⚠ `?ts=` 是超表的分区键。写成新时刻会去另一个 chunk 里找这一行，而报错只是
 * 一句「数据行不存在」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetRecord } from '@dt/contracts'
import { toLocalMinuteInput } from '@dt/ui'

import * as dataset from '@/api/dataset'
import RecordFormDialog from '@/pages/Dataset/TableDetail/components/RecordFormDialog.vue'

const STAMP = '2026-01-01T00:00:00.000Z'
const ROW_TS = '2026-02-02T03:04:00.000Z'
const MOVED_TS = '2026-02-03T03:04:00.000Z'

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

const COLUMNS = [
  column({ id: 'c1', key: 'inflow', name: '进水量' }),
  column({ id: 'c2', key: 'kwh', name: '用电量', source: 'point' }),
  column({ id: 'c3', key: 'ratio', name: '单耗', source: 'formula' }),
]

function record(over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    row_id: 'r1',
    ts: ROW_TS,
    values: { inflow: 12, kwh: 34 },
    overrides: null,
    samples: null,
    computed: { ratio: 2.8 },
    compute_error: null,
    source: 'collect',
    created_by_name: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function writeOut(hasStale = false) {
  return { record: record(), has_stale_downstream: hasStale }
}

beforeEach(() => {
  vi.spyOn(dataset, 'createDatasetRecord').mockResolvedValue(writeOut())
  vi.spyOn(dataset, 'updateDatasetRecord').mockResolvedValue(writeOut())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(target: DatasetRecord | null) {
  const wrapper = mount(RecordFormDialog, {
    props: {
      modelValue: true,
      tableId: 't1',
      columns: COLUMNS,
      record: target,
    },
  })
  await flushPromises()
  return wrapper
}

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-input__el')]
}

async function type(index: number, value: string): Promise<void> {
  const field = inputs()[index]
  if (field === undefined) throw new Error(`第 ${index} 个输入框不存在`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

async function pickMoment(iso: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>('.dt-datetime__el')
  if (field === null) throw new Error('数据时间那一格不存在')
  field.value = toLocalMinuteInput(iso)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

async function save(): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === '保存',
  )
  button?.click()
  await flushPromises()
}

describe('打开即铺好现值', () => {
  it('编辑态每一格都是这一行的生效值', async () => {
    await open(record())
    expect(inputs()[0]?.value).toBe('12')
    expect(inputs()[1]?.value).toBe('34')
  })

  it('公式列只读摆着，说清是保存后算的', async () => {
    await open(record())
    expect(document.body.textContent).toContain('单耗')
    expect(document.body.textContent).toContain('2.8')
    await open(null)
    expect(document.body.textContent).toContain('保存后计算')
  })

  it('⚠ 新建时点位汇总列留空：填上什么，保存时就等于替它建了一格修正', async () => {
    await open(null)
    expect(inputs()[1]?.value).toBe('')
  })

  it('表里有点位汇总列时先把「填了会记为人工修正」说在前面', async () => {
    await open(record())
    expect(document.body.textContent).toContain('人工修正')
    expect(document.body.textContent).toContain('没动过的格子不会提交')
  })
})

describe('提交', () => {
  it('⚠ 没动过的点位汇总列不进载荷', async () => {
    await open(record())
    await type(0, '20')
    await save()
    const [, input] = vi.mocked(dataset.updateDatasetRecord).mock.calls[0] ?? []
    expect(input?.values).toHaveProperty('inflow', '20')
    expect(input?.values).not.toHaveProperty('kwh')
  })

  it('动过的点位汇总列才提交，那一格才会被记成人工修正', async () => {
    await open(record())
    await type(1, '77')
    await save()
    const [, input] = vi.mocked(dataset.updateDatasetRecord).mock.calls[0] ?? []
    expect(input?.values).toHaveProperty('kwh', '77')
  })

  it('⚠ 改数据时间时，`?ts=` 仍是改之前那一刻——它是分区键', async () => {
    await open(record())
    await pickMoment(MOVED_TS)
    await save()
    const [row, input] =
      vi.mocked(dataset.updateDatasetRecord).mock.calls[0] ?? []
    expect(row).toEqual({ tableId: 't1', rowId: 'r1', ts: ROW_TS })
    expect(input?.ts).toBe(MOVED_TS)
  })

  it('新建走建行那条，回执里的脏信号原样上报', async () => {
    vi.mocked(dataset.createDatasetRecord).mockResolvedValue(writeOut(true))
    const wrapper = await open(null)
    await type(0, '9')
    await save()
    expect(dataset.createDatasetRecord).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('saved')?.[0]).toEqual(['数据行已录入', true])
  })

  it('⚠ 后端的取值裁定原样转述，不在前端再写一份规则', async () => {
    vi.mocked(dataset.updateDatasetRecord).mockRejectedValue(
      new (await import('@/api/client')).BizError(
        41213,
        '必填列未填写：进水量',
        422,
        'trace',
      ),
    )
    const wrapper = await open(record())
    await type(0, '')
    await save()
    expect(document.body.textContent).toContain('必填列未填写：进水量')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
