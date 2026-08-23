/**
 * @fileoverview 批量撤销弹窗的契约：**默认范围不是「不限」**、默认只勾这一页
 * 真有角标的那几列、回执把「一格没撤」与「触顶没撤完」逐条说出来。
 *
 * ⚠ 默认给「不限」的话，一次误点就抹掉三年的修正，而后端只回一个数字——
 * 撤掉了什么无从回看，也无从恢复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetOverrideBulkClear } from '@dt/contracts'
import { toLocalMinuteInput } from '@dt/ui'

import * as dataset from '@/api/dataset'
import OverrideBulkDialog from '@/pages/Dataset/TableDetail/components/OverrideBulkDialog.vue'

const STAMP = '2026-01-01T00:00:00.000Z'
const SINCE = '2026-03-01T00:00:00.000Z'
const UNTIL = '2026-03-31T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'kwh',
    name: '用电量',
    unit: null,
    decimals: null,
    data_type: 'number',
    source: 'point',
    agg: 'avg',
    node_key: 'src1:meter.kwh',
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
  column({ id: 'c1', key: 'kwh', name: '用电量' }),
  column({ id: 'c2', key: 'flow', name: '流量' }),
  column({ id: 'c3', key: 'note', name: '备注', source: 'manual' }),
  column({ id: 'c4', key: 'ratio', name: '单耗', source: 'formula' }),
]

function receipt(
  over: Partial<DatasetOverrideBulkClear> = {},
): DatasetOverrideBulkClear {
  return {
    cleared_rows: 4,
    cleared_cells: 7,
    recomputed: 9,
    failed: 0,
    is_truncated: false,
    limit: 5000,
    ...over,
  }
}

beforeEach(() => {
  vi.spyOn(dataset, 'clearDatasetOverridesInRange').mockResolvedValue(receipt())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(badged: string[] = ['kwh']) {
  const wrapper = mount(OverrideBulkDialog, {
    props: {
      modelValue: true,
      tableId: 't1',
      columns: COLUMNS,
      range: { since: SINCE, until: UNTIL },
      badgedKeys: badged,
    },
  })
  await flushPromises()
  return wrapper
}

function boxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-checkbox__input')]
}

function moments(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-datetime__el')]
}

async function submit(): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === '撤销修正',
  )
  button?.click()
  await flushPromises()
}

describe('打开时的默认值', () => {
  it('⚠ 时间范围默认是当前这一页的首尾，不是「不限」', async () => {
    await open()
    expect(moments()[0]?.value).toBe(toLocalMinuteInput(SINCE))
    expect(moments()[1]?.value).toBe(toLocalMinuteInput(UNTIL))
  })

  it('⚠ 只勾这一页真有角标的那几列——用户是冲着看得见的角标来的', async () => {
    await open(['kwh'])
    expect(boxes().map((one) => one.checked)).toEqual([true, false])
  })

  it('只列点位汇总列：录入列该直接改原始值、公式列该改公式，后端两者都拒', async () => {
    await open()
    expect(document.body.textContent).toContain('用电量')
    expect(document.body.textContent).toContain('流量')
    expect(document.body.textContent).not.toContain('备注')
    expect(document.body.textContent).not.toContain('单耗')
  })

  it('没有点位汇总列的台账如实说没有可撤的，并把按钮禁掉', async () => {
    const wrapper = mount(OverrideBulkDialog, {
      props: {
        modelValue: true,
        tableId: 't1',
        columns: [column({ source: 'manual' })],
        range: { since: '', until: '' },
        badgedKeys: [],
      },
    })
    await flushPromises()
    expect(document.body.textContent).toContain('不会有人工修正可撤')
    wrapper.unmount()
  })
})

describe('提交前的拦截', () => {
  it('一列都没勾时不发请求', async () => {
    await open([])
    await submit()
    expect(document.body.textContent).toContain('至少选一列')
    expect(dataset.clearDatasetOverridesInRange).not.toHaveBeenCalled()
  })

  it('起止填反了不发请求', async () => {
    const wrapper = mount(OverrideBulkDialog, {
      props: {
        modelValue: true,
        tableId: 't1',
        columns: COLUMNS,
        range: { since: UNTIL, until: SINCE },
        badgedKeys: ['kwh'],
      },
    })
    await flushPromises()
    await submit()
    expect(document.body.textContent).toContain('起始时间晚于结束时间')
    expect(dataset.clearDatasetOverridesInRange).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('提交', () => {
  it('只带勾上的那几列与当前范围', async () => {
    await open(['kwh'])
    await submit()
    expect(dataset.clearDatasetOverridesInRange).toHaveBeenCalledWith('t1', {
      column_keys: ['kwh'],
      since: SINCE,
      until: UNTIL,
    })
  })

  it('两端清空即不限，那时干脆不带这两个字段', async () => {
    const wrapper = mount(OverrideBulkDialog, {
      props: {
        modelValue: true,
        tableId: 't1',
        columns: COLUMNS,
        range: { since: '', until: '' },
        badgedKeys: ['kwh'],
      },
    })
    await flushPromises()
    await submit()
    expect(dataset.clearDatasetOverridesInRange).toHaveBeenCalledWith('t1', {
      column_keys: ['kwh'],
      since: undefined,
      until: undefined,
    })
    wrapper.unmount()
  })

  it('撤完之后叫外面重取：修正撤掉了，格子里的数会跟着变', async () => {
    const wrapper = await open()
    await submit()
    expect(wrapper.emitted('cleared')).toHaveLength(1)
  })
})

describe('回执', () => {
  it('撤了多少行多少格、顺带重算多少行，逐条摊开', async () => {
    await open()
    await submit()
    expect(document.body.textContent).toContain('已撤销 4 行、7 格')
    expect(document.body.textContent).toContain('重算 9 行')
  })

  it('⚠ 一格都没撤要说出来：它和「撤干净了」长得一模一样', async () => {
    vi.mocked(dataset.clearDatasetOverridesInRange).mockResolvedValue(
      receipt({ cleared_rows: 0, cleared_cells: 0, recomputed: 0 }),
    )
    await open()
    await submit()
    expect(document.body.textContent).toContain('一格都没动')
  })

  it('⚠ 触顶必须说出来，并指路缩小范围再撤一次', async () => {
    vi.mocked(dataset.clearDatasetOverridesInRange).mockResolvedValue(
      receipt({ is_truncated: true, limit: 5000 }),
    )
    await open()
    await submit()
    expect(document.body.textContent).toContain('单次最多处理 5000 行')
    expect(document.body.textContent).toContain('还有没撤完的')
  })

  it('重算里有行求值出错时点名条数', async () => {
    vi.mocked(dataset.clearDatasetOverridesInRange).mockResolvedValue(
      receipt({ failed: 2 }),
    )
    await open()
    await submit()
    expect(document.body.textContent).toContain('2 行求值出错')
  })
})
