/**
 * @fileoverview 权限目录专属卡的呈现契约：名称主 / 码次、说明缺席仍占位、
 * 持有与来历两态都可见。
 *
 * ⚠ 说明段缺席若整行消失，同一行三张卡的底部状态轨就会错位，而状态轨齐平
 * 正是「我持有哪些」能被横向扫读的前提。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PermissionItem } from '@dt/contracts'

import PermissionCard from '@/pages/System/Permissions/components/PermissionCard.vue'

function item(over: Partial<PermissionItem> = {}): PermissionItem {
  return {
    id: 'p1',
    code: 'user:grant',
    name: '授予权限',
    description: '给角色或用户写权限码',
    group_code: 'user',
    group_label: '用户与角色',
    sort_order: 10,
    kind: 'admin',
    is_builtin: true,
    ...over,
  }
}

function render(over: Partial<PermissionItem> = {}, held = false) {
  return mount(PermissionCard, { props: { item: item(over), held } })
}

describe('PermissionCard', () => {
  it('卡片的根节点就是这一页的专属卡', () => {
    expect(render().find('.permission-card').exists()).toBe(true)
  })

  it('名称当标题、码当副标识：同组的码前缀相同，拿名称才扫得动', () => {
    const wrapper = render()
    expect(wrapper.find('h3').text()).toBe('授予权限')
    expect(wrapper.find('code').text()).toBe('user:grant')
  })

  it('档位与来历各出一枚标', () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('高危')
    expect(wrapper.text()).toContain('内置')
  })

  it('持有时给一枚可扫读的标，且不再说未持有', () => {
    const text = render({}, true).text()
    expect(text).toContain('持有')
    expect(text).not.toContain('未持有')
  })

  it('未持有也要有文字，不靠颜色单通道', () => {
    expect(render({}, false).text()).toContain('未持有')
  })

  it('没有说明也渲染一行占位，卡不会因此缩一截', () => {
    const wrapper = render({ description: null })
    expect(wrapper.text()).toContain('—')
  })

  it('自建码显式标出来：它不被任何端点消费', () => {
    expect(render({ is_builtin: false }).text()).toContain('自建')
  })

  it('名称与码各自挂全文提示，截断了也查得到', () => {
    const wrapper = render()
    expect(wrapper.find('h3').attributes('title')).toBe('授予权限')
    expect(wrapper.find('p').attributes('title')).toBe('user:grant')
  })
})
