/**
 * @fileoverview 跨表引用那一栏的契约：可引用的名单来自函数目录，列要再取一次
 * 对方的列定义，而这一趟**失败只丢跨表引用**。
 *
 * ⚠ 目录只给 code 与名称，取列定义要 id，故中间还有一次「code → id」的换算。
 * 换算不上（那张表刚被删了）与取列失败是两件事，文案要分开：前者该让人换一张，
 * 后者是「这一趟没打通」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetTableSummary } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import * as dataset from '@/api/dataset'
import FormulaCrossTable from '@/pages/Dataset/TableDetail/components/FormulaCrossTable.vue'

const STAMP = '2026-01-01T00:00:00.000Z'

function summary(code: string, id: string): DatasetTableSummary {
  return {
    id,
    code,
    name: `${code} 台账`,
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 1,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function column(key: string): DatasetColumn {
  return {
    id: `c-${key}`,
    table_id: 'w1',
    key,
    name: `${key} 列`,
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
  }
}

beforeEach(() => {
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue({
    items: [summary('water', 'w1'), summary('power', 'p1')],
    total: 2,
    page: 1,
    size: 200,
  })
  vi.spyOn(dataset, 'listDatasetColumns').mockResolvedValue([column('inflow')])
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

function open() {
  return mount(FormulaCrossTable, {
    props: { tables: [{ code: 'water', name: '水量台账' }] },
  })
}

type CrossTable = ReturnType<typeof open>

async function pick(wrapper: CrossTable, code: string): Promise<void> {
  wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', code)
  await flushPromises()
}

describe('选一张表', () => {
  it('名单来自目录，一张都没有时整段不出现', () => {
    const wrapper = mount(FormulaCrossTable, { props: { tables: [] } })
    expect(wrapper.text()).toBe('')
  })

  it('选了就按 code 换出 id，再取那张表的列', async () => {
    const wrapper = open()
    await pick(wrapper, 'water')
    expect(dataset.listDatasetColumns).toHaveBeenCalledWith('w1')
    expect(wrapper.text()).toContain('inflow 列')
  })

  it('点一下插 {表code.列key}', async () => {
    const wrapper = open()
    await pick(wrapper, 'water')
    await wrapper.get('.ftb-chip').trigger('click')
    expect(wrapper.emitted('insert')?.[0]?.[0]).toEqual({
      snippet: '{water.inflow}',
      caret: '{water.inflow}'.length,
    })
  })

  it('清空选择就把列收回去', async () => {
    const wrapper = open()
    await pick(wrapper, 'water')
    await pick(wrapper, '')
    expect(wrapper.text()).not.toContain('inflow 列')
  })

  it('那张表一列都没有时说一句', async () => {
    vi.mocked(dataset.listDatasetColumns).mockResolvedValue([])
    const wrapper = open()
    await pick(wrapper, 'water')
    expect(wrapper.text()).toContain('这张台账还没有列')
  })
})

describe('降级', () => {
  it('⚠ code 换不出 id（那张表刚被删了）说的是「换一张」', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 200,
    })
    const wrapper = open()
    await pick(wrapper, 'water')
    expect(wrapper.text()).toContain('这张台账已经不在了')
  })

  it('⚠ 取列失败只丢跨表引用，且不弹成整页错误', async () => {
    vi.mocked(dataset.listDatasetColumns).mockRejectedValue(new Error('boom'))
    const wrapper = open()
    await pick(wrapper, 'water')
    expect(wrapper.text()).toContain('跨表引用只能手写')
  })
})
