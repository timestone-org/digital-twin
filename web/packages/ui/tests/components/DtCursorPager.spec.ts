/**
 * @fileoverview DtCursorPager 的契约：只报得出来的页序与本页条数，两端到头时
 * 对应那颗禁用。⚠ 它绝不能出现「共 N 页」——游标分页给不出总数，编一个出来
 * 用户会照着它去核对。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtCursorPager from '../../src/components/DtCursorPager/DtCursorPager.vue'

type PagerProps = InstanceType<typeof DtCursorPager>['$props']

function mountPager(props: Partial<PagerProps> = {}) {
  return mount(DtCursorPager, {
    props: {
      page: 1,
      count: 20,
      hasPrev: false,
      hasNext: true,
      ...props,
    },
  })
}

function buttons(
  wrapper: ReturnType<typeof mountPager>,
): Record<string, HTMLButtonElement | undefined> {
  const found = wrapper.findAll('button')
  return {
    prev: found[0]?.element,
    next: found[1]?.element,
  }
}

describe('DtCursorPager', () => {
  it('是一条有名字的导航，读屏说得清这是翻页', () => {
    const wrapper = mountPager({ ariaLabel: '事件翻页' })
    expect(wrapper.attributes('aria-label')).toBe('事件翻页')
    expect(wrapper.find('nav').exists()).toBe(true)
  })

  it('只报页序与本页条数，不谎报总页数', () => {
    const text = mountPager({ page: 3, count: 12 }).text()
    expect(text).toContain('第 3 页')
    expect(text).toContain('本页 12 条')
    expect(text).not.toContain('共')
    expect(text).not.toContain('/')
  })

  it('第一页上「上一页」禁用，翻不出界', () => {
    const wrapper = mountPager({ hasPrev: false })
    expect(buttons(wrapper).prev?.disabled).toBe(true)
    expect(buttons(wrapper).next?.disabled).toBe(false)
  })

  it('没有下一页时「下一页」禁用', () => {
    const wrapper = mountPager({ hasPrev: true, hasNext: false })
    expect(buttons(wrapper).next?.disabled).toBe(true)
  })

  it('取数中两颗都禁用——连点会一路翻过头', () => {
    const wrapper = mountPager({ hasPrev: true, hasNext: true, loading: true })
    expect(buttons(wrapper).prev?.disabled).toBe(true)
    expect(buttons(wrapper).next?.disabled).toBe(true)
  })

  it('点两颗各抛各的事件', async () => {
    const wrapper = mountPager({ hasPrev: true, hasNext: true })
    const found = wrapper.findAll('button')
    await found[0]?.trigger('click')
    await found[1]?.trigger('click')
    expect(wrapper.emitted('prev')).toHaveLength(1)
    expect(wrapper.emitted('next')).toHaveLength(1)
  })
})
