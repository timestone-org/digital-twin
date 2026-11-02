/** @fileoverview 折叠分区的受控状态、默认状态与内容生命周期契约。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DtDisclosure from '../../src/components/DtDisclosure/DtDisclosure.vue'

describe('DtDisclosure', () => {
  it('默认展开，点击标题后折叠并保留正文', async () => {
    const wrapper = mount(DtDisclosure, {
      props: { title: '参数' },
      slots: { default: '<input value="未保存内容" />' },
    })
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    expect(wrapper.get('summary').text()).toContain('参数')
    await wrapper.get('summary').trigger('click')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('input').element.value).toBe('未保存内容')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    await wrapper.get('summary').trigger('click')
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    wrapper.unmount()
  })

  it('defaultOpen 为 false 时初始折叠，标题插槽可覆盖文字', () => {
    const wrapper = mount(DtDisclosure, {
      props: { title: '原始内容', defaultOpen: false },
      slots: { title: '<strong>高级参数</strong>', default: '正文' },
    })
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('summary strong').text()).toBe('高级参数')
    wrapper.unmount()
  })

  it('受控模式仅请求更新并跟随后续 open，折叠时可卸载正文', async () => {
    const wrapper = mount(DtDisclosure, {
      props: { title: '视点', open: false, unmountOnClose: true },
      slots: { default: '<input />' },
    })
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.get('summary').trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[true]])
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    await wrapper.setProps({ open: true })
    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.get('summary').attributes('aria-controls')).toBe(
      wrapper.get('.dt-disclosure__body').attributes('id'),
    )
    await wrapper.setProps({ open: false })
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })
})
