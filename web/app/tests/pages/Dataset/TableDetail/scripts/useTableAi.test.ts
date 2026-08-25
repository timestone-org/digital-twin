/**
 * @fileoverview 契约：采纳一条提议 = 把它带进弹窗，而不是落库。
 *
 * 另守一条容易漏的：采纳之后预填必须清掉。不清的话，用户下一次自己点
 * 「新增列」，弹窗里会凭空带着上一条提议的公式——而他多半不会注意到，
 * 直接保存。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { DatasetColumn } from '@dt/contracts'

import {
  activeSurface,
  runClientTool,
  __resetSurfaces,
} from '@/features/ai/surfaces'
import {
  useTableAi,
  type TableAi,
} from '@/pages/Dataset/TableDetail/scripts/useTableAi'

function column(key: string): DatasetColumn {
  return {
    id: `id-${key}`,
    table_id: 't1',
    key,
    name: key,
    unit: null,
    decimals: null,
    data_type: 'number',
    source: 'manual',
    agg: 'last',
    node_key: null,
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: '',
    updated_at: '',
  }
}

interface Harness {
  ai: TableAi
  isFormOpen: ReturnType<typeof ref<boolean>>
  openCreate: ReturnType<typeof vi.fn>
  openEdit: ReturnType<typeof vi.fn>
  wrapper: ReturnType<typeof mount>
}

function setup(columns: DatasetColumn[]): Harness {
  __resetSurfaces()
  let ai!: TableAi
  const isFormOpen = ref(false)
  const openCreate = vi.fn(() => {
    isFormOpen.value = true
  })
  const openEdit = vi.fn(() => {
    isFormOpen.value = true
  })
  const host = defineComponent({
    setup() {
      ai = useTableAi({
        tableId: () => 't1',
        tableName: () => '光伏日报',
        columns: () => columns,
        isFormOpen,
        openCreate,
        openEdit,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { ai, isFormOpen, openCreate, openEdit, wrapper }
}

/** 走完整条路：模型下发 → 已登记的工作面执行 → 提议落到卡片上。 */
async function propose(_ctx: Harness, columnKey: string): Promise<void> {
  await runClientTool({
    call_id: 'c1',
    name: 'dataset.propose_formula',
    arguments: {
      column_key: columnKey,
      formula: '{本期} * 2',
      reading: '本期的两倍',
    },
  })
}

describe('采纳一条提议', () => {
  it('已有的列走编辑弹窗', async () => {
    const ctx = setup([column('本期')])
    await propose(ctx, '本期')
    ctx.ai.adopt()
    expect(ctx.openEdit).toHaveBeenCalledTimes(1)
    expect(ctx.ai.seed.value.formula).toBe('{本期} * 2')
    ctx.wrapper.unmount()
  })

  it('没有的列走新增弹窗，并把标识一起带过去', async () => {
    const ctx = setup([column('本期')])
    await propose(ctx, '增量')
    ctx.ai.adopt()
    expect(ctx.openCreate).toHaveBeenCalledTimes(1)
    expect(ctx.ai.seed.value).toEqual({ formula: '{本期} * 2', key: '增量' })
    ctx.wrapper.unmount()
  })

  it('采纳之后那张卡就消失', async () => {
    const ctx = setup([column('本期')])
    await propose(ctx, '本期')
    ctx.ai.adopt()
    expect(ctx.ai.proposal.value).toBeNull()
    ctx.wrapper.unmount()
  })

  it('弹窗关上之后预填清掉', async () => {
    const ctx = setup([column('本期')])
    await propose(ctx, '本期')
    ctx.ai.adopt()
    // ⚠ 中间这一拍不能省：弹窗打开与关上并在同一拍里的话，watch 两头看到的
    // 是同一个值，回调一次都不跑——而用例会因此绿得毫无道理
    await ctx.wrapper.vm.$nextTick()
    ctx.isFormOpen.value = false
    await ctx.wrapper.vm.$nextTick()
    expect(ctx.ai.seed.value).toEqual({})
    ctx.wrapper.unmount()
  })

  it('没有提议在飞时采纳是空动作', () => {
    const ctx = setup([column('本期')])
    ctx.ai.adopt()
    expect(ctx.openCreate).not.toHaveBeenCalled()
    expect(ctx.openEdit).not.toHaveBeenCalled()
    ctx.wrapper.unmount()
  })

  it('不用：卡片消失且什么都不打开', async () => {
    const ctx = setup([column('本期')])
    await propose(ctx, '本期')
    ctx.ai.dismiss()
    expect(ctx.ai.proposal.value).toBeNull()
    expect(ctx.openEdit).not.toHaveBeenCalled()
    ctx.wrapper.unmount()
  })
})

describe('离开这一页', () => {
  it('卸载时把工作面撤掉', () => {
    const ctx = setup([column('本期')])
    ctx.wrapper.unmount()
    // 不撤的话，助手仍握着一份指向已经没了的页面的句柄
    expect(activeSurface()).toBeNull()
  })
})
