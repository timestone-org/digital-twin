/**
 * @fileoverview 路由规则卡片的呈现契约：判定链的链节与首条、停用态的四条
 * 降级通道、空描述占位，以及三个操作事件的透传。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { RouteRule } from '@dt/contracts'

import RuleCard from '@/pages/System/RouteRules/components/RuleCard.vue'
import { useAuthStore } from '@/stores/auth'

function rule(over: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 'x1',
    path_pattern: '/api/v1/auth/sessions*',
    http_method: 'GET',
    permission_codes: ['user:view'],
    match_mode: 'all',
    priority: 995,
    is_enabled: true,
    is_builtin: false,
    description: '登录/刷新/登出',
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function render(over: Partial<RouteRule> = {}, order = 1) {
  return mount(RuleCard, { props: { rule: rule(over), order } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = {
    permissions: ['route_rule:view', 'route_rule:manage'],
    role: { name: 'admin' },
  } as never
  auth.accessToken = 'token'
})

describe('RuleCard', () => {
  it('卡片根挂着本页专属类名——插槽名写错时这条会红', () => {
    expect(render().find('.rule-card').exists()).toBe(true)
  })

  // 卡片按宽度铺成多列后，位置不再表达判定序，全靠这个数字
  it('判定序只认 order 入参，与卡片摆在哪一列无关', () => {
    expect(render({}, 1).find('.rule-card__step').text()).toBe('#1')
    expect(render({}, 14).find('.rule-card__step').text()).toBe('#14')
  })

  it('链节说的是「第几个被检查」，与事实区的优先级分开两处', () => {
    const wrapper = render({ priority: 800 }, 7)
    const step = wrapper.find('.rule-card__step')
    expect(step.text()).toBe('#7')
    expect(step.attributes('title')).toBe('第 7 个被检查')
    expect(wrapper.text()).toContain('优先级')
    expect(wrapper.text()).toContain('800')
  })

  it('停用态同时走形状、文字、颜色与底色四条通道', () => {
    const wrapper = render({ is_enabled: false })
    const card = wrapper.find('.rule-card')
    expect(card.classes()).toContain('rule-card--off')
    expect(wrapper.text()).toContain('不参与判定')
    expect(wrapper.text()).toContain('已停用')
    expect(card.attributes('style')).toContain('--card-bg')
  })

  it('启用态不改卡片底色变量', () => {
    expect(render().find('.rule-card').attributes('style') ?? '').not.toContain(
      '--card-bg',
    )
  })

  it('没有描述也占一行，卡与卡的链节间距才均匀', () => {
    const wrapper = render({ description: null })
    expect(wrapper.find('p').text()).toBe('未填写描述')
  })

  it('空码集在卡片里同样写成「任意登录用户」', () => {
    expect(render({ permission_codes: [] }).text()).toContain('任意登录用户')
  })

  it('三个操作事件带着本条规则往上抛', async () => {
    const wrapper = render()
    await wrapper.find('[aria-label="编辑规则"]').trigger('click')
    await wrapper.find('[aria-label="停用"]').trigger('click')
    await wrapper.find('[aria-label="删除规则"]').trigger('click')
    expect(wrapper.emitted('edit')?.[0]).toEqual([rule()])
    expect(wrapper.emitted('toggle-enabled')?.[0]).toEqual([rule()])
    expect(wrapper.emitted('remove')?.[0]).toEqual([rule()])
  })

  it('操作区自己承担贴底与分隔线，卡片不再包一层容器', () => {
    const actions = render().find('.rule-card [aria-label="删除规则"]')
    const bar = actions.element.parentElement
    expect(bar?.className).toContain('mt-auto')
    expect(bar?.className).toContain('border-t')
    expect(bar?.className).toContain('justify-end')
  })

  it('无权限时操作区连同它的分隔线一起不进 DOM', () => {
    const auth = useAuthStore()
    auth.user = {
      permissions: ['route_rule:view'],
      role: { name: 'viewer' },
    } as never
    const wrapper = render()
    expect(wrapper.find('[aria-label="删除规则"]').exists()).toBe(false)
    expect(wrapper.find('.border-t').exists()).toBe(false)
  })
})
