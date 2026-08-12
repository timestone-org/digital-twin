/**
 * @fileoverview 左栏「组合覆盖」的契约：三十多个组合一条不藏、条形按组内最大值
 * 取比例、点一条抛出筛选值、再点一次抛空串回到「全部组合」。
 * ⚠ 条数少的一旦被藏起来，「这个组合没数据」就被显示成了「这个组合没问题」。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { CombinationCoverage } from '@dt/contracts'

import CoverageSidebar from '@/pages/Hvac/Startups/components/CoverageSidebar.vue'

/** 六台空调排出来的那种规模：一条独大，其余是长尾。 */
function manyCombinations(): CombinationCoverage[] {
  return Array.from({ length: 31 }, (_, index) => ({
    running_set: [`K${String(index + 1).padStart(2, '0')}`],
    usable_count: index === 0 ? 120 : index,
  }))
}

function open(
  items: CombinationCoverage[],
  selected = '',
): ReturnType<typeof mount> {
  return mount(CoverageSidebar, { props: { items, selected } })
}

describe('CoverageSidebar', () => {
  it('三十多个组合一条不少地列出来，样本少的照样看得见', () => {
    const wrapper = open(manyCombinations())
    expect(wrapper.findAll('button[aria-pressed]')).toHaveLength(31)
    expect(wrapper.text()).toContain('样本太少')
  })

  it('条形按组内最多的那条取比例，一眼看出谁占了绝大多数', () => {
    const wrapper = open([
      { running_set: ['K01'], usable_count: 100 },
      { running_set: ['K02'], usable_count: 25 },
    ])
    const bars = wrapper.findAll('[role="progressbar"]')
    expect(bars[0]?.attributes('aria-valuenow')).toBe('100')
    expect(bars[0]?.attributes('aria-valuemax')).toBe('100')
    expect(bars[1]?.attributes('aria-valuenow')).toBe('25')
    expect(bars[1]?.attributes('aria-valuemax')).toBe('100')
  })

  it('一条都还没攒到时条形不炸成 NaN——上限至少是 1', () => {
    const wrapper = open([{ running_set: ['K01'], usable_count: 0 }])
    expect(
      wrapper.find('[role="progressbar"]').attributes('aria-valuemax'),
    ).toBe('1')
  })

  it('点一条抛出逗号连接的序号串，与工具条那个筛选器同口径', async () => {
    const wrapper = open([{ running_set: ['K02', 'K03'], usable_count: 9 }])
    await wrapper.find('button[aria-pressed]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['K02,K03']])
  })

  it('再点一次选中的那条就回到「全部组合」', async () => {
    const wrapper = open([{ running_set: ['K01'], usable_count: 9 }], 'K01')
    await wrapper.find('button[aria-pressed]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['']])
  })

  it('选中的那条看得出来是选中的', () => {
    const wrapper = open(
      [
        { running_set: ['K01'], usable_count: 9 },
        { running_set: ['K02'], usable_count: 8 },
      ],
      'K02',
    )
    const rows = wrapper.findAll('button[aria-pressed]')
    // 排序按条数从多到少，K01 在前
    expect(rows[0]?.attributes('aria-pressed')).toBe('false')
    expect(rows[1]?.attributes('aria-pressed')).toBe('true')
    expect(rows[1]?.classes()).toContain('bg-accent-primary/10')
  })

  it('一条事件都没有时说清是还没抽取，不是空白', () => {
    const wrapper = open([])
    expect(wrapper.text()).toContain('还没有可用事件')
    expect(wrapper.findAll('button[aria-pressed]')).toHaveLength(0)
  })

  it('自己那栏内部滚动，不把右边的事件挤到折叠线以下', () => {
    const list = open(manyCombinations()).find('ul')
    expect(list.classes()).toEqual(
      expect.arrayContaining(['overflow-y-auto', 'min-h-0', 'flex-1']),
    )
  })
})
