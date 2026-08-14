/**
 * @fileoverview 守卡片骨架的结构契约：有标题才画标题栏、标题留空时主体吃满，
 * ⚠ 内容走**默认插槽**——插槽名写错既不报错也不渲染，只能靠用例兜。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModulePanel from '../../src/shared/ModulePanel.vue'

const BODY = '<div class="content">今日发电量</div>'

describe('卡片骨架', () => {
  it('有标题时画标题栏，内容落在主体里', () => {
    const wrapper = mount(ModulePanel, {
      props: { title: '能耗总览' },
      slots: { default: BODY },
    })

    expect(wrapper.get('.module-title-bar__text').text()).toBe('能耗总览')
    expect(wrapper.get('.module-panel__body .content').text()).toBe(
      '今日发电量',
    )
  })

  it('标题留空时不画标题栏，主体照常渲染', () => {
    const wrapper = mount(ModulePanel, { slots: { default: BODY } })

    expect(wrapper.find('.module-title-bar').exists()).toBe(false)
    expect(wrapper.find('.module-panel__body .content').exists()).toBe(true)
  })

  it('纯空白标题按没有标题算', () => {
    const wrapper = mount(ModulePanel, { props: { title: '   ' } })

    expect(wrapper.find('.module-title-bar').exists()).toBe(false)
  })
})
