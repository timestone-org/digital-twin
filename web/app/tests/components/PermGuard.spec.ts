/**
 * @fileoverview 锁住闸 3 的渲染契约：无权限时元素**不存在于 DOM**，
 * 而不是仅仅隐藏——隐藏元素仍可被读取与触发。
 *
 * ⚠ `explain` 那几条守的是另一件事：页面级主入口凭空消失而不解释，用户分不清
 * 是功能没做、页面坏了、还是自己没权限，最后变成一张「这功能是不是没上线」的工单。
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

describe('explain：主入口被藏掉时留一句话', () => {
  function mountExplain(codes: string[], slots?: Record<string, string>) {
    return mount(PermGuard, {
      props: { codes, explain: true },
      slots: { default: '<b class="ok">内容</b>', ...slots },
    })
  }

  it('有权限时不多出一句「只读」', () => {
    grant(['user:view'])
    const wrapper = mountExplain(['user:view'])
    expect(wrapper.find('.ok').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('只读')
  })

  it('无权限时留一句，说清是权限不是缺功能', () => {
    grant([])
    const wrapper = mountExplain(['user:view'])
    expect(wrapper.find('[data-test="perm-readonly"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('只读')
  })

  it('不开 explain 就什么都不留：行内小按钮每个都挂一句是纯噪音', () => {
    grant([])
    const wrapper = mount(PermGuard, {
      props: { codes: ['user:view'] },
      slots: { default: '<b class="ok">内容</b>' },
    })
    expect(wrapper.text()).toBe('')
  })

  it('自带 fallback 时按自己的来，不被这句默认文案盖掉', () => {
    grant([])
    const wrapper = mountExplain(['user:view'], {
      fallback: '<i class="own">这台设备由现场负责人维护</i>',
    })
    expect(wrapper.find('.own').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('只读')
  })
})
