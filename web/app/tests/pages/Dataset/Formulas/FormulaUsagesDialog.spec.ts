/**
 * @fileoverview 引用反查弹窗的契约：波及面怎么摆、间接引用怎么标、
 * 以及「重算在哪做」这句指路。
 *
 * ⚠ 这一页**没有**批量重算：后端只有按表的 `:recompute`，没有按公式的批量作业。
 * 摆一个按不动的按钮不如老实指路，这条用例钉的就是那句话。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import FormulaUsagesDialog from '@/pages/Dataset/Formulas/components/FormulaUsagesDialog.vue'
import type { FormulaUsageRow } from '@/pages/Dataset/Formulas/scripts/formulaView'

function row(over: Partial<FormulaUsageRow> = {}): FormulaUsageRow {
  return {
    id: 'c1',
    table_id: 't1',
    table_code: 'energy',
    table_name: '能耗台账',
    column_id: 'c1',
    column_key: '标煤',
    column_name: '折标煤量',
    formula: '@折标煤({电耗})',
    is_direct: true,
    ...over,
  }
}

enableAutoUnmount(afterEach)

function open(over: Partial<Record<string, unknown>> = {}) {
  return mount(FormulaUsagesDialog, {
    props: {
      modelValue: true,
      title: '折标煤',
      rows: [row()],
      loading: false,
      error: null,
      ...over,
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

/** 那一行上挂没挂「间接」徽标。⚠ 不能拿整页文本判：说明那段话里也有这两个字。 */
function hasIndirectTag(): boolean {
  return [...document.querySelectorAll('.dt-tag')].some((node) =>
    node.textContent?.includes('间接'),
  )
}

describe('引用反查弹窗', () => {
  it('标题点名是哪一条公式的引用面', () => {
    open()
    expect(document.body.textContent).toContain('引用「折标煤」的台账列')
  })

  it('⚠ 指清重算在各自的台账详情页做——这里没有批量重算', () => {
    open()
    expect(document.body.textContent).toContain('详情页重算')
  })

  it('列出台账、列名与那一列的公式', () => {
    open()
    expect(document.body.textContent).toContain('能耗台账')
    expect(document.body.textContent).toContain('折标煤量')
    expect(document.body.textContent).toContain('@折标煤({电耗})')
  })

  it('间接引用要标出来：改这一列救不了，得去改那条库公式', () => {
    open({ rows: [row({ is_direct: false })] })
    expect(hasIndirectTag()).toBe(true)
  })

  it('直接引用不标', () => {
    open()
    expect(hasIndirectTag()).toBe(false)
  })

  it('取数失败给得出重试，而不是一片空白', async () => {
    const wrapper = open({ rows: [], error: '请求失败，请重试' })
    expect(document.body.textContent).toContain('请求失败')
    const retry = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === '重试',
    )
    retry?.click()
    await flushPromises()
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('关掉时把开关交回调用方', async () => {
    const wrapper = open()
    const close = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === '关闭',
    )
    close?.click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })
})
