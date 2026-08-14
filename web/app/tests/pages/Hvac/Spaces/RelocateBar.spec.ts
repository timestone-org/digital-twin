/**
 * @fileoverview 改派条的一条契约：房间选项整批换掉时，已选的目标房间要作废。
 * ⚠ 不作废就会拿着上一个车间的房间 id 去提交，后端 404，而界面上目标房间
 * 那一格看起来是填好的。
 */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { DtSelectOption } from '@dt/contracts'

import RelocateBar from '@/pages/Hvac/Spaces/components/RelocateBar.vue'

const FIRST: DtSelectOption[] = [{ value: 'r1', label: '注塑房' }]
const SECOND: DtSelectOption[] = [{ value: 'r9', label: '西装配房' }]

describe('改派条', () => {
  it('报出已选台数', () => {
    const wrapper = mount(RelocateBar, {
      props: { count: 3, roomOptions: FIRST, isBusy: false },
    })
    expect(wrapper.text()).toContain('已选 3 台')
  })

  it('换了一批房间选项就把已选目标清掉', async () => {
    const wrapper = mount(RelocateBar, {
      props: { count: 1, roomOptions: FIRST, isBusy: false },
    })
    await wrapper.find('.dt-select__trigger').trigger('click')
    await flushPromises()
    const option = document.querySelector('.dt-select-menu__item')
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const submit = wrapper
      .findAll('button')
      .find((node) => node.text().includes('改派到这个房间'))
    expect(submit?.attributes('disabled')).toBeUndefined()

    await wrapper.setProps({ roomOptions: SECOND })
    await flushPromises()
    expect(submit?.attributes('disabled')).toBeDefined()
  })

  it('提交中时不许再改目标房间', () => {
    const wrapper = mount(RelocateBar, {
      props: { count: 1, roomOptions: FIRST, isBusy: true },
    })
    expect(wrapper.find('.dt-select__trigger').attributes('disabled')).toBe('')
  })
})
