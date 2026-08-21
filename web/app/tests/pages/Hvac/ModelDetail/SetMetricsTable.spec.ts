/**
 * @fileoverview 按服务组合的评估表：行点击写回同一个筛选器（再点=取消），
 * 无样本的组合照样列出来但点不动，选中行用 aria-current 标出。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { SetMetricsRow } from '@/features/hvac/modelView'
import SetMetricsTable from '@/pages/Hvac/ModelDetail/components/SetMetricsTable.vue'

function rowOf(set: string, over: Partial<SetMetricsRow> = {}): SetMetricsRow {
  return {
    id: set,
    set,
    count: '热 12 / 零 3',
    r2: '0.91',
    r2Class: 'text-state-success',
    mae: '0.4',
    coverage: '92%',
    width: '1.2',
    zeroHit: '98%',
    hotHit: '95%',
    reliabilityLabel: '可靠',
    reliabilityIntent: 'success',
    hasSamples: true,
    ...over,
  }
}

function mountTable(rows: SetMetricsRow[], selected = '') {
  return mount(SetMetricsTable, { props: { rows, selected } })
}

function setButtons(wrapper: ReturnType<typeof mountTable>) {
  return wrapper.findAll('td button')
}

describe('行选中', () => {
  it('选中的那行标 aria-current，未选中的不落属性', () => {
    const wrapper = mountTable([rowOf('K01'), rowOf('K02')], 'K02')
    const buttons = setButtons(wrapper)

    expect(buttons[0]?.attributes('aria-current')).toBeUndefined()
    expect(buttons[1]?.attributes('aria-current')).toBe('true')
  })

  it('点一行抛出组合键，写回折外总览那一个筛选器', async () => {
    const wrapper = mountTable([rowOf('K01,K02')])

    await setButtons(wrapper)[0]?.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['K01,K02']])
  })

  it('再点选中的那行抛空串，回到「全部组合」', async () => {
    const wrapper = mountTable([rowOf('K01')], 'K01')

    await setButtons(wrapper)[0]?.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['']])
  })
})

describe('无样本的组合', () => {
  it('照样列出来，但行键禁用、说明原因', () => {
    const wrapper = mountTable([rowOf('K09', { hasSamples: false })])
    const button = setButtons(wrapper)[0]

    expect(button?.text()).toContain('K09')
    expect(button?.attributes('disabled')).toBeDefined()
    expect(button?.attributes('title')).toContain('还没有可用事件')
  })

  it('禁用行点了不抛 select', async () => {
    const wrapper = mountTable([rowOf('K09', { hasSamples: false })])

    await setButtons(wrapper)[0]?.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
