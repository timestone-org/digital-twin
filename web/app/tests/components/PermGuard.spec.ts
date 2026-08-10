/**
 * @fileoverview 锁住闸 3 的渲染契约：无权限时元素**不存在于 DOM**，
 * 而不是仅仅隐藏——隐藏元素仍可被读取与触发。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { useAuthStore } from '@/stores/auth'
import PermGuard from '@/components/PermGuard.vue'

function mountGuard(codes: string[], mode?: 'all' | 'any') {
  return mount(PermGuard, {
    props: mode ? { codes, mode } : { codes },
    slots: { default: '<b class="ok">内容</b>', fallback: '<i class="no"/>' },
  })
}

function grant(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = { permissions: codes } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('PermGuard', () => {
  it('有权限时渲染默认插槽', () => {
    grant(['user:view'])
    expect(mountGuard(['user:view']).find('.ok').exists()).toBe(true)
  })

  it('无权限时默认插槽完全不进 DOM', () => {
    grant([])
    const wrapper = mountGuard(['user:view'])
    expect(wrapper.find('.ok').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('内容')
  })

  it('无权限时渲染 fallback 插槽', () => {
    grant([])
    expect(mountGuard(['user:view']).find('.no').exists()).toBe(true)
  })

  it('all 模式要求全部持有', () => {
    grant(['user:view'])
    const wrapper = mountGuard(['user:view', 'role:manage'])
    expect(wrapper.find('.ok').exists()).toBe(false)
  })

  it('any 模式命中其一即可', () => {
    grant(['user:view'])
    const wrapper = mountGuard(['user:view', 'role:manage'], 'any')
    expect(wrapper.find('.ok').exists()).toBe(true)
  })

  it('未登录（无 user）时一律不渲染', () => {
    expect(mountGuard(['user:view']).find('.ok').exists()).toBe(false)
  })
})
