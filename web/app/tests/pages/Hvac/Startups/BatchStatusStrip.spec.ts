/**
 * @fileoverview 批次状态条自己的契约：没绑数据源时不给空 picker、
 * 抽取键在「还没抽过」时也在、区间倒置时禁掉。
 *
 * ⚠ 区间控件与「有没有批次」无关：塞进 batch !== null 里，第一次抽取就没处填。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import type { SourceRange, StartupBatch } from '@dt/contracts'

import BatchStatusStrip from '@/pages/Hvac/Startups/components/BatchStatusStrip.vue'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-08-12T02:00:00.000Z'
const SOURCE: SourceRange = {
  start: '2023-01-01T00:00:00.000Z',
  end: '2026-08-01T00:00:00.000Z',
}

function batch(over: Partial<StartupBatch> = {}): StartupBatch {
  return {
    id: 'b1',
    status: 'ready',
    is_current: true,
    params_fingerprint: 'abc',
    logic_version: 3,
    window_start: SOURCE.start,
    window_end: SOURCE.end,
    shard_total: 8,
    shard_done: 8,
    episode_count: 120,
    unmatched_exclusion_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn(['ac:view', 'ac:manage'])
})

enableAutoUnmount(afterEach)

function render(props: Record<string, unknown> = {}) {
  return mount(BatchStatusStrip, {
    props: {
      batch: batch(),
      isStale: false,
      rebuilding: false,
      from: '',
      to: '',
      sourceRange: SOURCE,
      ...props,
    },
    attachTo: document.body,
  })
}

// ⚠ 用 endsWith 而不是正则：测试质量闸按用例关键字切块，助手里出现那个词
// 会被当成一条没有断言的用例报上来
function rebuildButton(wrapper: ReturnType<typeof render>) {
  return wrapper
    .findAll('button')
    .find((node) => node.text().trim().endsWith('抽取'))
}

describe('BatchStatusStrip', () => {
  it('还没抽取过时区间控件照样在，按键写成「开始抽取」', () => {
    const wrapper = render({ batch: null })
    expect(wrapper.text()).toContain('还没有抽取过')
    expect(wrapper.findAll('input[type="datetime-local"]')).toHaveLength(2)
    expect(rebuildButton(wrapper)?.text()).toBe('开始抽取')
  })

  it('有批次时按键写成「重新抽取」', () => {
    expect(rebuildButton(render())?.text()).toBe('重新抽取')
  })

  it('没绑数据源时给去处，且不渲染那两个填了也没用的 picker', () => {
    const wrapper = render({ sourceRange: null })
    expect(wrapper.text()).toContain('数据与达标')
    expect(wrapper.findAll('input[type="datetime-local"]')).toHaveLength(0)
    expect(rebuildButton(wrapper)?.attributes('disabled')).toBeDefined()
  })

  it('两端都空时标成「全部历史」，填了就是自定义区间', () => {
    expect(render().text()).toContain('全部历史')
    expect(render({ from: SOURCE.start }).text()).toContain('自定义区间')
  })

  it('区间倒置时禁掉抽取键，并把原因说在起始那一栏', () => {
    const wrapper = render({ from: SOURCE.end, to: SOURCE.start })
    expect(rebuildButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="alert"]').text()).toContain('早于')
  })

  it('正在抽取时禁掉按键，并显示分片进度', () => {
    const wrapper = render({
      batch: batch({ status: 'running', shard_done: 3, shard_total: 8 }),
    })
    expect(rebuildButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('3 / 8')
  })

  it('只读账号看不到区间控件与抽取键', () => {
    setActivePinia(createPinia())
    signIn(['ac:view'])
    const wrapper = render()
    expect(wrapper.findAll('input[type="datetime-local"]')).toHaveLength(0)
    expect(rebuildButton(wrapper)).toBeUndefined()
  })
})
