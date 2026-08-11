/**
 * @fileoverview 路由规则页四个共用小件的呈现契约：方法字面量与读法同源、
 * 停用态的字色通道、状态文案、以及「满足其一」只在真有区别时才出现。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { RouteRule } from '@dt/contracts'

import MethodTag from '@/pages/System/RouteRules/components/MethodTag.vue'
import RuleBadges from '@/pages/System/RouteRules/components/RuleBadges.vue'
import RuleCodes from '@/pages/System/RouteRules/components/RuleCodes.vue'
import RulePattern from '@/pages/System/RouteRules/components/RulePattern.vue'

function rule(over: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 'x1',
    path_pattern: '/api/v1/auth/sessions*',
    http_method: '*',
    permission_codes: [],
    match_mode: 'all',
    priority: 995,
    is_enabled: true,
    is_builtin: false,
    description: null,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

describe('MethodTag', () => {
  it('通配方法保留字面 * ，读法挂在 title 上', () => {
    const wrapper = mount(MethodTag, { props: { method: '*' } })
    expect(wrapper.text()).toBe('*')
    expect(wrapper.attributes('title')).toBe('任意方法')
  })

  it('具体方法的 title 说清它是一类请求', () => {
    const wrapper = mount(MethodTag, { props: { method: 'GET' } })
    expect(wrapper.text()).toBe('GET')
    expect(wrapper.attributes('title')).toBe('GET 请求')
  })
})

describe('RulePattern', () => {
  it('启用态用标题色', () => {
    const wrapper = mount(RulePattern, { props: { rule: rule() } })
    expect(wrapper.classes()).toContain('text-text-title')
    expect(wrapper.attributes('title')).toBe('/api/v1/auth/sessions*')
  })

  it('停用态只降字色，不叠 opacity', () => {
    const wrapper = mount(RulePattern, {
      props: { rule: rule({ is_enabled: false }) },
    })
    expect(wrapper.classes()).toContain('text-text-disabled')
    expect(wrapper.classes()).not.toContain('opacity-50')
  })
})

describe('RuleBadges', () => {
  it('状态标签带文字，不靠颜色单独表达', () => {
    expect(mount(RuleBadges, { props: { rule: rule() } }).text()).toContain(
      '已启用',
    )
    expect(
      mount(RuleBadges, {
        props: { rule: rule({ is_enabled: false }) },
      }).text(),
    ).toContain('已停用')
  })

  it('只有 emphasis 才把主状态放大到 md', () => {
    const plain = mount(RuleBadges, { props: { rule: rule() } })
    expect(plain.find('.dt-tag--md').exists()).toBe(false)
    const strong = mount(RuleBadges, {
      props: { rule: rule(), emphasis: true },
    })
    expect(strong.find('.dt-tag--md').text()).toBe('已启用')
  })

  it('内置标签只对内置规则出现，且恒为 sm', () => {
    expect(mount(RuleBadges, { props: { rule: rule() } }).text()).not.toContain(
      '内置',
    )
    const builtin = mount(RuleBadges, {
      props: { rule: rule({ is_builtin: true }), emphasis: true },
    })
    expect(builtin.text()).toContain('内置')
    expect(builtin.findAll('.dt-tag--md')).toHaveLength(1)
  })
})

describe('RuleCodes', () => {
  it('空码集写成「任意登录用户」而不是留白', () => {
    const wrapper = mount(RuleCodes, { props: { codes: [], mode: 'all' } })
    expect(wrapper.text()).toContain('任意登录用户')
  })

  it('any 且不止一个码时给出读法标签', () => {
    const wrapper = mount(RuleCodes, {
      props: { codes: ['a:view', 'b:view'], mode: 'any' },
    })
    expect(wrapper.text()).toContain('满足其一')
    expect(wrapper.text()).toContain('a:view')
  })

  it('只有一个码时不标模式——两种模式结果相同', () => {
    const wrapper = mount(RuleCodes, {
      props: { codes: ['a:view'], mode: 'any' },
    })
    expect(wrapper.text()).not.toContain('满足其一')
  })

  it('all 模式不标模式', () => {
    const wrapper = mount(RuleCodes, {
      props: { codes: ['a:view', 'b:view'], mode: 'all' },
    })
    expect(wrapper.text()).not.toContain('满足其一')
  })
})
