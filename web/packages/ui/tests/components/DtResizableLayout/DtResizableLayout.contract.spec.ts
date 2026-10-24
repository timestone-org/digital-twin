/** @fileoverview 可调整布局的公开导出、具名插槽与分隔条契约。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { DtResizableLayout, type ResizablePane } from '../../../src'

const panes: readonly ResizablePane[] = [
  { id: 'outline', label: '大纲', size: 1, minSize: 100 },
  { id: 'canvas', label: '画布', size: 3, minSize: 200 },
]

describe('DtResizableLayout 公开接口', () => {
  it('通过 id 挂载所有具名区块，并给分隔条提供键盘与读屏信息', () => {
    const wrapper = mount(DtResizableLayout, {
      props: { panes, label: '编辑器', storageKey: 'contract-layout' },
      slots: {
        outline: '<aside>大纲内容</aside>',
        canvas: '<main>画布内容</main>',
      },
    })
    expect(wrapper.find('[data-pane="outline"]').text()).toBe('大纲内容')
    expect(wrapper.find('[data-pane="canvas"]').text()).toBe('画布内容')
    const separator = wrapper.get('[role="separator"]')
    expect(separator.attributes('aria-label')).toBe('编辑器：大纲 / 画布')
    expect(separator.attributes('aria-orientation')).toBe('vertical')
    expect(separator.attributes('tabindex')).toBe('0')
    expect(separator.attributes('aria-valuenow')).toBeDefined()
    expect(separator.attributes('aria-valuemin')).toBeDefined()
    expect(separator.attributes('aria-valuemax')).toBeDefined()
    wrapper.unmount()
  })

  it('未指定区块标签时以稳定 id 标记分隔条', () => {
    const wrapper = mount(DtResizableLayout, {
      props: { panes: [{ id: 'one' }, { id: 'two' }] },
    })
    expect(wrapper.get('[role="separator"]').attributes('aria-label')).toBe(
      '调整区块：one / two',
    )
    wrapper.unmount()
  })
  it('纵向布局提供水平分隔条，单一区块无需分隔条', async () => {
    const wrapper = mount(DtResizableLayout, {
      props: { panes, direction: 'vertical' },
    })
    expect(
      wrapper.get('[role="separator"]').attributes('aria-orientation'),
    ).toBe('horizontal')
    await wrapper.setProps({ panes: [{ id: 'canvas' }] })
    expect(wrapper.find('[role="separator"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
