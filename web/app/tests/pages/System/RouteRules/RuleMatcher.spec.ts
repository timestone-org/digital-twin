/**
 * @fileoverview 「试一条路径」的行为契约：入口是一个按钮 + 一个弹窗，
 * 三种判定结果各有明确文案，且界面必须说清它是预演不是判定。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AuthUser, RouteRule } from '@dt/contracts'

import RuleMatcher from '@/pages/System/RouteRules/components/RuleMatcher.vue'
import { useAuthStore } from '@/stores/auth'

function rule(over: Partial<RouteRule> = {}): RouteRule {
  return {
    id: 'r',
    path_pattern: '/api/v1/auth/users*',
    http_method: 'GET',
    permission_codes: ['user:view'],
    match_mode: 'all',
    priority: 965,
    is_enabled: true,
    is_builtin: true,
    description: null,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

/** 登录态假件：`/users/me` 的形状，三组权限码都在。 */
function signIn(codes: string[]): void {
  const user: AuthUser = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '',
    updated_at: '',
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  useAuthStore().user = user
}

// ⚠ DtModal 与 DtSelect 的浮层都 teleport 到 body；stub 掉才能用 wrapper 断言
function render(rules: RouteRule[]) {
  return mount(RuleMatcher, {
    props: { rules },
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  })
}

type Matcher = ReturnType<typeof render>

function launcher(wrapper: Matcher) {
  return wrapper.find('button')
}

function buttonByText(wrapper: Matcher, text: string) {
  return wrapper.findAll('button').find((node) => node.text().trim() === text)
}

async function openDialog(rules: RouteRule[]): Promise<Matcher> {
  const wrapper = render(rules)
  await launcher(wrapper).trigger('click')
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
})

enableAutoUnmount(afterEach)

describe('RuleMatcher 的入口', () => {
  it('页面上只留一个触发按钮，试算表单不常驻', () => {
    signIn(['user:view'])
    const wrapper = render([rule()])
    expect(launcher(wrapper).text()).toContain('试一条路径')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('点按钮打开弹窗，表单在弹窗里', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-label')).toBe('试一条路径')
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('点关闭收起弹窗', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    await buttonByText(wrapper, '关闭')?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('按 Esc 收起弹窗', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    await wrapper.find('.dt-modal').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('关闭后焦点归还触发按钮', async () => {
    signIn(['user:view'])
    const wrapper = render([rule()])
    const button = launcher(wrapper).element
    button.focus()
    await launcher(wrapper).trigger('click')
    await flushPromises()
    expect(document.activeElement).not.toBe(button)
    await buttonByText(wrapper, '关闭')?.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(button)
  })

  it('关掉再打开保留上次输入的路径', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    await wrapper.find('input').setValue('/api/v1/auth/roles')
    await buttonByText(wrapper, '关闭')?.trigger('click')
    await flushPromises()
    await launcher(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('input').element.value).toBe('/api/v1/auth/roles')
  })
})

describe('RuleMatcher 的判定结果', () => {
  it('持有所需码时预演放行，并显示命中的规则', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    expect(wrapper.text()).toContain('放行')
    expect(wrapper.text()).toContain('/api/v1/auth/users*')
    expect(wrapper.text()).toContain('priority 965')
  })

  it('权限不足时明确说 403', async () => {
    signIn([])
    const wrapper = await openDialog([rule()])
    expect(wrapper.text()).toContain('权限不足 → 403')
  })

  it('没有规则命中时说明按 fail-closed 拒绝', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([])
    expect(wrapper.text()).toContain('无规则命中')
    expect(wrapper.text()).toContain('fail-closed')
  })

  it('空码规则对任意已登录用户放行', async () => {
    signIn([])
    const wrapper = await openDialog([rule({ permission_codes: [] })])
    expect(wrapper.text()).toContain('放行')
  })

  it('标明结果是按前端持有的码预演、真判定在服务端', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    expect(wrapper.text()).toContain('按你当前持有的 1 个权限码预演')
    expect(wrapper.text()).toContain('真正的判定在服务端')
  })
})

describe('RuleMatcher 的弹窗输入', () => {
  async function pickMethod(wrapper: Matcher, label: string): Promise<void> {
    await wrapper.find('.dt-select__trigger').trigger('click')
    await flushPromises()
    const option = wrapper
      .findAll('.dt-select-menu__item')
      .find((node) => node.text().trim() === label)
    await option?.trigger('click')
    await flushPromises()
  }

  it('改路径后判定结果跟着变', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    await wrapper.find('input').setValue('/api/v1/auth/nothing-matches')
    expect(wrapper.text()).toContain('无规则命中')
  })

  it('在弹窗里能选到方法，判定跟着换', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    expect(wrapper.text()).toContain('放行')
    await pickMethod(wrapper, 'POST')
    expect(wrapper.find('.dt-select__trigger').text()).toContain('POST')
    expect(wrapper.text()).toContain('无规则命中')
  })

  it('方法下拉不给搜索框——它会把焦点带出弹窗的焦点陷阱', async () => {
    signIn(['user:view'])
    const wrapper = await openDialog([rule()])
    await wrapper.find('.dt-select__trigger').trigger('click')
    await flushPromises()
    expect(wrapper.find('.dt-select-menu__search').exists()).toBe(false)
  })
})
