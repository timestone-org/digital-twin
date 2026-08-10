/**
 * @fileoverview DtSegmented 的行为契约：选中态同时给 aria-pressed（只靠颜色
 * 对读屏与色觉障碍都不成立）、iconOnly 必须留可访问名称、点击抛值不自己改。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DtSegmentedOption } from '@dt/contracts'

import DtSegmented from '../../src/components/DtSegmented/DtSegmented.vue'

const OPTIONS: DtSegmentedOption[] = [
  { value: 'table', label: '表格视图', icon: 'table', iconOnly: true },
  { value: 'card', label: '卡片视图' },
]

function render(modelValue = 'table') {
  return mount(DtSegmented, { props: { modelValue, options: OPTIONS } })
}

describe('DtSegmented', () => {
  it('每个选项一个按钮', () => {
    expect(render().findAll('button')).toHaveLength(2)
  })

  it('选中项带 aria-pressed=true，其余为 false', () => {
    const pressed = render()
      .findAll('button')
      .map((b) => b.attributes('aria-pressed'))
    expect(pressed).toEqual(['true', 'false'])
  })

  it('iconOnly 的项把 label 留给读屏，不是丢掉', () => {
    const first = render().findAll('button')[0]
    expect(first?.attributes('aria-label')).toBe('表格视图')
    expect(first?.text()).toBe('')
  })

  it('非 iconOnly 的项直接显示文字', () => {
    expect(render().findAll('button')[1]?.text()).toBe('卡片视图')
  })

  it('点击抛值，组件自己不改选中态（受控组件）', async () => {
    const wrapper = render()
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['card']])
    expect(wrapper.findAll('button')[0]?.attributes('aria-pressed')).toBe(
      'true',
    )
  })

  it('分组带可访问名称', () => {
    const wrapper = mount(DtSegmented, {
      props: { modelValue: 'table', options: OPTIONS, ariaLabel: '展示方式' },
    })
    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe(
      '展示方式',
    )
  })
})
