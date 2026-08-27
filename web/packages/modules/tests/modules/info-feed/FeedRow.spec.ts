/**
 * @fileoverview 守信息流一条的渲染：四件都按「有没有内容」决定画不画、档位类与逐行变量真的
 * 落到行上、点一条上抛的是原始正文，以及「有正文才吞冒泡」这条与整块可点的分工。
 * ⚠ 件画错位置或类名拼错，typecheck 与 lint 双双放行——只能靠挂载断言兜。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { FeedRowView } from '../../../src/modules/info-feed/feed'
import FeedRow from '../../../src/modules/info-feed/FeedRow.vue'
import {
  readFeedLook,
  type FeedLook,
} from '../../../src/modules/info-feed/look'

function row(over: Partial<FeedRowView> = {}): FeedRowView {
  return {
    key: '0|danger|暴雨红色预警',
    index: 0,
    level: 'danger',
    label: '危险',
    text: '暴雨红色预警',
    pickValue: '暴雨红色预警',
    time: '10:24',
    rank: 4,
    vars: { '--if-level-color': 'var(--state-danger)' },
    ...over,
  }
}

function look(config: Record<string, unknown> = {}): FeedLook {
  return readFeedLook(config)
}

function render(source: FeedRowView, shape: FeedLook) {
  return mount(FeedRow, { props: { row: source, look: shape } })
}

describe('四件按有没有内容画', () => {
  it('齐活的一条画出圆点、级别、正文与时刻四件', () => {
    const wrapper = render(row(), look())

    expect(wrapper.find('.if-dot').exists()).toBe(true)
    expect(wrapper.get('.if-level').text()).toBe('危险')
    expect(wrapper.get('.if-text').text()).toBe('暴雨红色预警')
    expect(wrapper.get('.if-time').text()).toBe('10:24')
  })

  it('圆点是纯装饰，读屏不该把它读成一个字', () => {
    expect(render(row(), look()).get('.if-dot').attributes('aria-hidden')).toBe(
      'true',
    )
  })

  it('认不出的级别没有文字标记，那一位整件不画', () => {
    const wrapper = render(row({ label: '' }), look())

    expect(wrapper.find('.if-level').exists()).toBe(false)
    expect(wrapper.get('.if-text').text()).toBe('暴雨红色预警')
  })

  it('没推时刻的一条不占时刻位', () => {
    expect(
      render(row({ time: '' }), look())
        .find('.if-time')
        .exists(),
    ).toBe(false)
  })

  it('三个开关各自关掉自己那一件，正文永远在', () => {
    const wrapper = render(
      row(),
      look({ showDot: false, showLevel: false, showTime: false }),
    )

    expect(wrapper.find('.if-dot').exists()).toBe(false)
    expect(wrapper.find('.if-level').exists()).toBe(false)
    expect(wrapper.find('.if-time').exists()).toBe(false)
    expect(wrapper.get('.if-text').text()).toBe('暴雨红色预警')
  })
})

describe('正文的完整文本', () => {
  it('长句被截断时靠 title 给全文', () => {
    const wrapper = render(row({ text: '一二三四五六七八九十' }), look())

    expect(wrapper.get('.if-text').attributes('title')).toBe(
      '一二三四五六七八九十',
    )
  })

  it('没有正文的那一条不挂 title——浮出来一个占位符是纯噪音', () => {
    const wrapper = render(row({ text: '—', pickValue: '' }), look())

    expect(wrapper.get('.if-text').attributes('title')).toBeUndefined()
  })
})

describe('档位类与逐行变量', () => {
  it('两组档位类都挂在行上，样式表据此换档', () => {
    const wrapper = render(
      row(),
      look({ rowBorderStyle: 'dashed', timePlace: 'left' }),
    )
    const classes = wrapper.get('.if-row').classes()

    expect(classes).toContain('if--border-dashed')
    expect(classes).toContain('if--time-left')
  })

  it('级别色摊成行内变量，认不出的级别一个键都不写', () => {
    expect(render(row(), look()).get('.if-row').attributes('style')).toContain(
      '--if-level-color: var(--state-danger)',
    )
    expect(
      render(row({ vars: {} }), look())
        .get('.if-row')
        .attributes('style'),
    ).toBeUndefined()
  })
})

describe('点一条', () => {
  it('上抛的是原始正文，不是屏上的占位符', async () => {
    const wrapper = render(row({ text: '—', pickValue: '阵风 8 级' }), look())
    await wrapper.get('.if-row').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([['阵风 8 级']])
  })

  it('有正文的一条吞冒泡，没正文的放它上去让整块兜底', async () => {
    const spy = vi.fn()
    document.body.addEventListener('click', spy)

    const picked = mount(FeedRow, {
      attachTo: document.body,
      props: { row: row(), look: look() },
    })
    await picked.get('.if-row').trigger('click')
    expect(spy).not.toHaveBeenCalled()
    expect(picked.emitted('pick')).toEqual([['暴雨红色预警']])
    picked.unmount()

    const plain = mount(FeedRow, {
      attachTo: document.body,
      props: { row: row({ pickValue: '' }), look: look() },
    })
    await plain.get('.if-row').trigger('click')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(plain.emitted('pick')).toBeUndefined()
    plain.unmount()

    document.body.removeEventListener('click', spy)
  })
})
