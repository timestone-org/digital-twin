/**
 * @fileoverview DtField 的标签、按需帮助与常驻校验提示契约。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import DtField from '../../src/components/DtField/DtField.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('字段说明', () => {
  it('help 只显示问号入口，点开后才显示说明', async () => {
    const wrapper = mount(DtField, {
      props: { label: '量程上限', help: '必须大于量程下限。' },
      attachTo: document.body,
    })

    expect(wrapper.text()).toBe('量程上限')
    const button = wrapper.find('button[aria-label="量程上限说明"]')
    expect(button.exists()).toBe(true)

    await button.trigger('click')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      '必须大于量程下限。',
    )
    wrapper.unmount()
  })

  it('hint 仍作为需要常驻的输入提示直接显示', () => {
    const wrapper = mount(DtField, {
      props: { label: '名称', hint: '必填' },
    })

    expect(wrapper.text()).toContain('必填')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
