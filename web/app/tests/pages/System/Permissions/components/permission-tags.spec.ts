/**
 * @fileoverview 权限档位标与来历标的呈现契约：四档各有自己的文字、色意与图形，
 * 来历两态都可见。
 *
 * ⚠ 档位只靠颜色区分是不可读的——这两条断言（文字 + 图形）就是另外两条通道，
 * 少一条都会让色觉差异或暗屏把「操作」和「高危」压成同一坨。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PermissionKind } from '@dt/contracts'

import PermissionKindTag from '@/pages/System/Permissions/components/PermissionKindTag.vue'
import PermissionOriginTag from '@/pages/System/Permissions/components/PermissionOriginTag.vue'

const LABELS: Record<PermissionKind, string> = {
  view: '查看',
  manage: '管理',
  operate: '操作',
  admin: '高危',
}

const KINDS: readonly PermissionKind[] = ['view', 'manage', 'operate', 'admin']

describe('PermissionKindTag', () => {
  it.each(KINDS)('%s 档给出自己的文字', (kind) => {
    const wrapper = mount(PermissionKindTag, { props: { kind } })
    expect(wrapper.text()).toContain(LABELS[kind])
  })

  it.each(KINDS)('%s 档给出自己的图形，颜色不是唯一通道', (kind) => {
    const wrapper = mount(PermissionKindTag, { props: { kind } })
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('四档的色意互不相同', () => {
    const tints = KINDS.map((kind) =>
      mount(PermissionKindTag, { props: { kind } })
        .find('.dt-tag')
        .attributes('style'),
    )
    expect(new Set(tints).size).toBe(4)
  })

  it('图标跟着标签尺寸走：sm 10px、md 12px', () => {
    const small = mount(PermissionKindTag, { props: { kind: 'view' } })
    const medium = mount(PermissionKindTag, {
      props: { kind: 'view', size: 'md' },
    })
    expect(small.find('svg').attributes('width')).toBe('10')
    expect(medium.find('svg').attributes('width')).toBe('12')
  })
})

describe('PermissionOriginTag', () => {
  it('内置码标「内置」并说明它由种子维护', () => {
    const wrapper = mount(PermissionOriginTag, { props: { isBuiltin: true } })
    expect(wrapper.text()).toContain('内置')
    expect(wrapper.find('.dt-tag').attributes('title')).toContain('种子')
  })

  it('自建码标「自建」而不是留白：它不被任何端点消费', () => {
    const wrapper = mount(PermissionOriginTag, { props: { isBuiltin: false } })
    expect(wrapper.text()).toContain('自建')
    expect(wrapper.find('.dt-tag').attributes('title')).toContain('不会被')
  })
})
