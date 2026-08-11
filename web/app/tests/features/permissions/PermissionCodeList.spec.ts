/**
 * @fileoverview 只读权限清单：只列持有的码、空组不出现、落单码不许被吞。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PermissionGroup } from '@dt/contracts'

import PermissionCodeList from '@/features/permissions/PermissionCodeList.vue'

const GROUPS: readonly PermissionGroup[] = [
  {
    code: 'user',
    label: '用户与角色',
    items: [
      {
        id: 'p1',
        code: 'user:view',
        name: '查看用户与角色',
        description: null,
        group_code: 'user',
        group_label: '用户与角色',
        sort_order: 10,
        kind: 'view',
        is_builtin: true,
      },
      {
        id: 'p2',
        code: 'user:grant',
        name: '授予用户角色与直权',
        description: null,
        group_code: 'user',
        group_label: '用户与角色',
        sort_order: 40,
        kind: 'admin',
        is_builtin: true,
      },
      {
        id: 'p3',
        code: 'user:manage',
        name: '管理用户',
        description: null,
        group_code: 'user',
        group_label: '用户与角色',
        sort_order: 20,
        kind: 'manage',
        is_builtin: true,
      },
    ],
  },
  {
    code: 'route_rule',
    label: '路由规则',
    items: [
      {
        id: 'p4',
        code: 'route_rule:manage',
        name: '管理路由规则',
        description: null,
        group_code: 'route_rule',
        group_label: '路由规则',
        sort_order: 20,
        kind: 'operate',
        is_builtin: true,
      },
    ],
  },
]

function render(codes: readonly string[]) {
  return mount(PermissionCodeList, { props: { codes, groups: GROUPS } })
}

describe('PermissionCodeList', () => {
  it('只列出持有的码，没持有的一个都不出现', () => {
    const wrapper = render(['user:view'])
    expect(wrapper.text()).toContain('查看用户与角色')
    expect(wrapper.text()).not.toContain('授予用户角色与直权')
    expect(wrapper.text()).not.toContain('管理用户')
  })

  it('命中数为 0 的分组整组不渲染', () => {
    const wrapper = render(['user:view'])
    expect(wrapper.text()).toContain('用户与角色')
    expect(wrapper.text()).not.toContain('路由规则')
  })

  it('目录里查不到的落单码归入「其他」，一个都不许少', () => {
    const codes = ['user:view', 'legacy:thing', 'dropped:code']
    const wrapper = render(codes)
    expect(wrapper.text()).toContain('其他')
    expect(wrapper.text()).toContain('legacy:thing')
    expect(wrapper.text()).toContain('dropped:code')
    expect(wrapper.findAll('code')).toHaveLength(codes.length)
  })

  it('operate 与 admin 打风险标，view 与 manage 不打', () => {
    const wrapper = render([
      'user:view',
      'user:manage',
      'user:grant',
      'route_rule:manage',
    ])
    const tags = wrapper.findAll('.dt-tag').map((node) => node.text())
    expect(tags).toEqual(['高危', '操作'])
  })

  it('空集合给一句话，不是一片留白', () => {
    const wrapper = render([])
    expect(wrapper.text()).toContain('只能访问免码路由')
  })
})
