/**
 * @fileoverview 契约：助手在台账页只提议、不落库。
 *
 * 守的是这一页与大屏编辑器的分界——那边改的是本地草稿、一次 Ctrl+Z 撤得掉，
 * 这边每一次写入都是真实落库且没有撤销栈。所以这一页的写工具只有一个，
 * 而它写的是一张待用户确认的提议，不是库。
 */
import { describe, expect, it } from 'vitest'
import type { AssistantToolCall, DatasetColumn } from '@dt/contracts'

import { createTableSurface } from '@/pages/Dataset/TableDetail/scripts/aiSurface'

function column(key: string, formula: string | null): DatasetColumn {
  return {
    id: `id-${key}`,
    table_id: 't1',
    key,
    name: key,
    unit: 'kWh',
    decimals: null,
    data_type: 'number',
    source: formula === null ? 'manual' : 'formula',
    agg: 'last',
    node_key: null,
    formula,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: '',
    updated_at: '',
  }
}

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

function setup(columns: DatasetColumn[] = [column('本期', null)]) {
  return createTableSurface({
    tableId: () => 't1',
    tableName: () => '光伏日报',
    columns: () => columns,
  })
}

describe('读列', () => {
  it('给出台账身份与每一列的取值来源', async () => {
    const table = setup()
    const shot = (await table.surface.run(
      call('dataset.read_columns', {}),
    )) as Record<string, unknown>
    expect(shot).toMatchObject({ table_id: 't1', column_count: 1 })
  })

  it('公式列带着它现在的表达式', async () => {
    const table = setup([column('增量', '{本期} - PREV({本期}, 1)')])
    const shot = (await table.surface.run(
      call('dataset.read_columns', {}),
    )) as Record<string, unknown>
    const columns = shot.columns as Record<string, unknown>[]
    expect(columns[0]).toMatchObject({
      key: '增量',
      source: 'formula',
      formula: '{本期} - PREV({本期}, 1)',
    })
  })
})

describe('提议公式', () => {
  it('落进待确认的提议里，而不是写库', async () => {
    const table = setup()
    await table.surface.run(
      call('dataset.propose_formula', {
        column_key: '增量',
        formula: '{本期} - PREV({本期}, 1)',
        reading: '本期减去上一期',
      }),
    )
    expect(table.proposal.value).toMatchObject({
      columnKey: '增量',
      formula: '{本期} - PREV({本期}, 1)',
    })
  })

  it('如实告诉模型这一列是新建还是改现有', async () => {
    const table = setup([column('本期', null)])
    const got = (await table.surface.run(
      call('dataset.propose_formula', {
        column_key: '本期',
        formula: '1 + 1',
        reading: '随便',
      }),
    )) as Record<string, unknown>
    // 它据此决定该跟用户说哪一句
    expect(got.is_existing_column).toBe(true)
    expect(table.proposal.value?.isExisting).toBe(true)
  })

  it('新列的提议标成新建', async () => {
    const table = setup([column('本期', null)])
    const got = (await table.surface.run(
      call('dataset.propose_formula', {
        column_key: '还没有的列',
        formula: '1 + 1',
        reading: '随便',
      }),
    )) as Record<string, unknown>
    expect(got.is_existing_column).toBe(false)
  })

  it('少了参数就抛，不留下一条半截的提议', async () => {
    const table = setup()
    await expect(
      table.surface.run(call('dataset.propose_formula', { column_key: 'x' })),
    ).rejects.toThrow(/formula/)
    expect(table.proposal.value).toBeNull()
  })
})

describe('这一页只有这两个工具', () => {
  it('认不出的一律抛，不静默成功', async () => {
    const table = setup()
    // 静默成功会让模型以为改好了，最后给用户一个「已完成」而库里什么都没动
    await expect(
      table.surface.run(call('dashboard.write_binding', {})),
    ).rejects.toThrow(/dashboard\.write_binding/)
  })
})
