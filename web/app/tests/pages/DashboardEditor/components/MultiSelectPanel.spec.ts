/**
 * @fileoverview 契约：多选面板报出已选数量，对齐 / 分布 / 批量删除各抛各的事件；
 * 条件不满足的那几档**渲染但禁用**，藏起来会让人以为功能不存在。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import MultiSelectPanel from '@/pages/DashboardEditor/components/MultiSelectPanel.vue'

function mountPanel(
  over: Partial<{
    count: number
    alignReady: boolean
    distributeReady: boolean
  }> = {},
) {
  return mount(MultiSelectPanel, {
    props: { count: 3, alignReady: true, distributeReady: true, ...over },
  })
}

describe('多选面板', () => {
  it('报出已选数量', () => {
    expect(
      mountPanel({ count: 5 }).find('[data-test="multi-count"]').text(),
    ).toContain('5')
  })

  it('六个方向各抛自己的那一档', async () => {
    const wrapper = mountPanel()
    const kinds = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']

    for (const kind of kinds) {
      await wrapper.find(`[data-test="multi-align-${kind}"]`).trigger('click')
    }

    expect(wrapper.emitted('align')?.map(([kind]) => kind)).toEqual(kinds)
  })

  it('两个轴各抛自己的那一档', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-test="multi-distribute-x"]').trigger('click')
    await wrapper.find('[data-test="multi-distribute-y"]').trigger('click')

    expect(wrapper.emitted('distribute')).toEqual([['x'], ['y']])
  })

  it('不同层级时对齐与分布禁用但仍在', async () => {
    const wrapper = mountPanel({ alignReady: false, distributeReady: false })

    expect(
      wrapper.find('[data-test="multi-align-left"]').attributes('disabled'),
    ).toBe('')
    expect(
      wrapper.find('[data-test="multi-distribute-x"]').attributes('disabled'),
    ).toBe('')

    await wrapper.find('[data-test="multi-align-left"]').trigger('click')
    expect(wrapper.emitted('align')).toBeUndefined()
  })

  it('分布单独不够数时只禁分布，不连坐对齐', () => {
    const wrapper = mountPanel({ alignReady: true, distributeReady: false })

    expect(
      wrapper.find('[data-test="multi-align-left"]').attributes('disabled'),
    ).toBeUndefined()
    expect(
      wrapper.find('[data-test="multi-distribute-y"]').attributes('disabled'),
    ).toBe('')
  })

  it('删除所选抛 remove-all', async () => {
    const wrapper = mountPanel()

    await wrapper.find('[data-test="multi-remove"]').trigger('click')

    expect(wrapper.emitted('remove-all')).toHaveLength(1)
  })
})
