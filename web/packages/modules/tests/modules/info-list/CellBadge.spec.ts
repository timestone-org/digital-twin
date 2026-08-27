/**
 * @fileoverview 守行内徽章位的三档自绘与设备状态那一档的让位：
 * 设备状态档整枚交给 StatusBadge（样式档对它不作用），严重度档是圆点加一个中文词，
 * 命中规则档画规则自己的文案。⚠ 后两档画的是两个不同的词，合成一档会让严重度整个消失。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CellBadge from '../../../src/modules/info-list/CellBadge.vue'
import { LEVEL_TEXT } from '../../../src/modules/info-list/options'
import type { BadgeView } from '../../../src/modules/info-list/rowAlarm'
import type { ListBadgeStyle } from '../../../src/modules/info-list/options'
import StatusBadge from '../../../src/shared/StatusBadge.vue'

function badge(over: Partial<BadgeView> = {}): BadgeView {
  return {
    kind: 'rule',
    status: null,
    text: '偏高',
    color: 'var(--state-warning)',
    vars: { '--il-badge-color': 'var(--state-warning)' },
    ...over,
  }
}

function render(
  over: Partial<BadgeView> = {},
  variant: ListBadgeStyle = 'outline',
) {
  return mount(CellBadge, { props: { badge: badge(over), variant } })
}

describe('设备状态那一档', () => {
  it('整枚交给共用的状态徽标，不自绘', () => {
    const wrapper = render({
      kind: 'device',
      status: 'running',
      text: '',
      color: '',
      vars: {},
    })

    expect(wrapper.findComponent(StatusBadge).exists()).toBe(true)
    expect(wrapper.find('.il-badge').exists()).toBe(false)
    expect(wrapper.text()).toBe('运行')
  })

  it('样式档对它不作用——五档配色与呼吸由状态徽标自己带', () => {
    for (const variant of ['outline', 'solid', 'dot'] as const) {
      const wrapper = render(
        { kind: 'device', status: 'alarm', text: '', color: '', vars: {} },
        variant,
      )

      expect(wrapper.findComponent(StatusBadge).exists()).toBe(true)
      expect(wrapper.classes()).not.toContain(`il-badge--${variant}`)
    }
  })
})

describe('自绘的三档', () => {
  it('描边档与实心档只有一个文字节点，没有圆点', () => {
    for (const variant of ['outline', 'solid'] as const) {
      const wrapper = render({}, variant)

      expect(wrapper.get('.il-badge').classes()).toContain(
        `il-badge--${variant}`,
      )
      expect(wrapper.find('.il-badge__dot').exists()).toBe(false)
      expect(wrapper.get('.il-badge__text').text()).toBe('偏高')
    }
  })

  it('圆点档是色 + 词双编码：只靠色相的话读屏完全拿不到', () => {
    const wrapper = render({ kind: 'severity', text: '危急' }, 'dot')

    expect(wrapper.find('.il-badge__dot').exists()).toBe(true)
    expect(wrapper.get('.il-badge__text').text()).toBe('危急')
  })

  it('颜色走取值层给的变量，不在模板里现拼', () => {
    const wrapper = render({
      vars: { '--il-badge-color': 'var(--state-danger)' },
    })

    expect(wrapper.get('.il-badge').attributes('style')).toContain(
      '--il-badge-color: var(--state-danger)',
    )
  })

  it('没给颜色变量时整条不注入，让它落回行当前色', () => {
    const wrapper = render({ color: '', vars: {} })

    expect(wrapper.get('.il-badge').attributes('style')).toBeUndefined()
  })
})

describe('严重度那四个词', () => {
  it('逐个原样画出来，不带括注', () => {
    for (const text of Object.values(LEVEL_TEXT)) {
      const wrapper = render({ kind: 'severity', text }, 'dot')

      expect(wrapper.get('.il-badge__text').text()).toBe(text)
      expect(text).not.toContain('（')
    }
  })

  it('严重度词与命中文案不是同一个词——同一枚徽章画哪一个由取值层定', () => {
    const severity = render(
      { kind: 'severity', text: LEVEL_TEXT.danger },
      'dot',
    )
    const rule = render({ kind: 'rule', text: '出口温度越限' }, 'dot')

    expect(severity.text()).toBe('危急')
    expect(rule.text()).toBe('出口温度越限')
  })
})
